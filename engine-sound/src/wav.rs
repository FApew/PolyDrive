//! Minimal RIFF/WAVE reader, so impulse responses can be handed to the library
//! as raw file bytes (an AudioWorklet has no `decodeAudioData`).
//!
//! Supports PCM 8/16/24/32-bit and IEEE float 32/64-bit. Multi-channel files are
//! downmixed to mono, which is what the convolution wants anyway.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WavError {
    TooShort,
    NotRiffWave,
    MissingFmt,
    MissingData,
    UnsupportedFormat { format: u16, bits: u16 },
}

impl core::fmt::Display for WavError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            WavError::TooShort => write!(f, "file is too short to be a WAV"),
            WavError::NotRiffWave => write!(f, "not a RIFF/WAVE file"),
            WavError::MissingFmt => write!(f, "no fmt chunk"),
            WavError::MissingData => write!(f, "no data chunk"),
            WavError::UnsupportedFormat { format, bits } => {
                write!(f, "unsupported WAV format {format} with {bits} bits")
            }
        }
    }
}

pub struct Wav {
    pub sample_rate: u32,
    /// Mono samples, normalised to roughly [-1, 1].
    pub samples: Vec<f32>,
}

fn u16_le(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}

fn u32_le(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

/// Decodes a WAV file into mono float samples.
pub fn decode(bytes: &[u8]) -> Result<Wav, WavError> {
    if bytes.len() < 12 {
        return Err(WavError::TooShort);
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(WavError::NotRiffWave);
    }

    let mut format = 0u16;
    let mut channels = 1u16;
    let mut sample_rate = 44100u32;
    let mut bits = 16u16;
    let mut data: Option<(usize, usize)> = None;

    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32_le(bytes, offset + 4) as usize;
        let body = offset + 8;
        let end = body.saturating_add(size).min(bytes.len());

        if id == b"fmt " && end - body >= 16 {
            format = u16_le(bytes, body);
            channels = u16_le(bytes, body + 2).max(1);
            sample_rate = u32_le(bytes, body + 4);
            bits = u16_le(bytes, body + 14);
            // WAVE_FORMAT_EXTENSIBLE: the real format is in the GUID.
            if format == 0xFFFE && end - body >= 26 {
                format = u16_le(bytes, body + 24);
            }
        } else if id == b"data" {
            data = Some((body, end));
        }

        offset = body + size + (size & 1);
    }

    if format == 0 {
        return Err(WavError::MissingFmt);
    }
    let (start, end) = data.ok_or(WavError::MissingData)?;
    let payload = &bytes[start..end];

    let frames: Vec<f32> = match (format, bits) {
        (1, 8) => payload
            .iter()
            .map(|&b| (b as f32 - 128.0) / 128.0)
            .collect(),
        (1, 16) => payload
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
            .collect(),
        (1, 24) => payload
            .chunks_exact(3)
            .map(|c| {
                let v = i32::from_le_bytes([0, c[0], c[1], c[2]]) >> 8;
                v as f32 / 8_388_608.0
            })
            .collect(),
        (1, 32) => payload
            .chunks_exact(4)
            .map(|c| i32::from_le_bytes([c[0], c[1], c[2], c[3]]) as f32 / 2_147_483_648.0)
            .collect(),
        (3, 32) => payload
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect(),
        (3, 64) => payload
            .chunks_exact(8)
            .map(|c| f64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]) as f32)
            .collect(),
        _ => return Err(WavError::UnsupportedFormat { format, bits }),
    };

    let channels = channels as usize;
    let samples = if channels <= 1 {
        frames
    } else {
        frames
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
            .collect()
    };

    Ok(Wav {
        sample_rate,
        samples,
    })
}

/// Naive linear resample. Impulse responses must match the audio sample rate.
pub fn resample(samples: &[f32], from_rate: f64, to_rate: f64) -> Vec<f32> {
    if samples.is_empty()
        || from_rate <= 0.0
        || to_rate <= 0.0
        || (from_rate - to_rate).abs() < 1e-6
    {
        return samples.to_vec();
    }

    let ratio = to_rate / from_rate;
    let out_len = ((samples.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src = i as f64 / ratio;
        let i0 = src.floor() as usize;
        let i1 = (i0 + 1).min(samples.len() - 1);
        let f = (src - i0 as f64) as f32;
        let a = samples[i0.min(samples.len() - 1)];
        let b = samples[i1];
        out.push(a * (1.0 - f) + b * f);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_wav_16(samples: &[i16], channels: u16, rate: u32) -> Vec<u8> {
        let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36u32 + data.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
        out.extend_from_slice(&(channels * 2).to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        out
    }

    #[test]
    fn decodes_mono_16_bit() {
        let bytes = build_wav_16(&[0, 16384, -16384, 32767], 1, 48000);
        let wav = decode(&bytes).unwrap();
        assert_eq!(wav.sample_rate, 48000);
        assert_eq!(wav.samples.len(), 4);
        assert!((wav.samples[1] - 0.5).abs() < 1e-6);
        assert!((wav.samples[2] + 0.5).abs() < 1e-6);
    }

    #[test]
    fn downmixes_stereo() {
        let bytes = build_wav_16(&[16384, -16384, 32767, 32767], 2, 44100);
        let wav = decode(&bytes).unwrap();
        assert_eq!(wav.samples.len(), 2);
        assert!(wav.samples[0].abs() < 1e-6);
        assert!((wav.samples[1] - 32767.0 / 32768.0).abs() < 1e-6);
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode(b"not a wav file at all").is_err());
    }

    #[test]
    fn resampling_changes_length() {
        let input: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let out = resample(&input, 22050.0, 44100.0);
        assert_eq!(out.len(), 200);
    }
}
