//! Just enough JSON to hand a list of warnings across the WebAssembly boundary
//! without inventing a separator that a warning could contain.

/// Renders strings as a JSON array.
pub fn array(items: &[String]) -> String {
    let mut out = String::from("[");
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        string_into(item, &mut out);
    }
    out.push(']');
    out
}

/// Renders one JSON string, escaping what the format requires.
pub fn string_into(value: &str, out: &mut String) {
    const QUOTE: char = '\u{22}';
    const BACKSLASH: char = '\u{5C}';

    out.push(QUOTE);
    for c in value.chars() {
        match c {
            QUOTE => {
                out.push(BACKSLASH);
                out.push(QUOTE);
            }
            BACKSLASH => {
                out.push(BACKSLASH);
                out.push(BACKSLASH);
            }
            '\u{0A}' => out.push_str("\\n"),
            '\u{0D}' => out.push_str("\\r"),
            '\u{09}' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push(QUOTE);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_an_array() {
        assert_eq!(array(&[]), "[]");
        assert_eq!(
            array(&["one".to_string(), "two".to_string()]),
            r#"["one","two"]"#
        );
    }

    #[test]
    fn escapes_what_json_requires() {
        let quote = '\u{22}';
        let backslash = '\u{5C}';
        let awkward = format!("a{quote}b{backslash}c\nd\te");
        let rendered = array(&[awkward]);

        // Round-trips through a real JSON parser.
        assert_eq!(rendered, r#"["a\"b\\c\nd\te"]"#);
    }

    #[test]
    fn escapes_control_characters() {
        let expected = format!("[{0}\\u0001{0}]", '\u{22}');
        assert_eq!(array(&["\u{1}".to_string()]), expected);
    }
}
