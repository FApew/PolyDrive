//! Tokeniser for the `.mr` (Piranha) engine description language.

use std::fmt;

#[derive(Clone, Debug, PartialEq)]
pub enum Tok {
    Ident(String),
    Float(f64),
    Int(i64),
    Str(String),
    /// `@name` inside a `module { }` block.
    At(String),
    LBrace,
    RBrace,
    LParen,
    RParen,
    LBracket,
    RBracket,
    Comma,
    Colon,
    Semi,
    Dot,
    Plus,
    Minus,
    Star,
    Slash,
    /// `=>`, which binds a node to a native implementation.
    FatArrow,
    Eof,
}

impl fmt::Display for Tok {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Tok::Ident(s) => write!(f, "{s}"),
            Tok::Float(v) => write!(f, "{v}"),
            Tok::Int(v) => write!(f, "{v}"),
            Tok::Str(s) => write!(f, "\"{s}\""),
            Tok::At(s) => write!(f, "@{s}"),
            Tok::LBrace => write!(f, "{{"),
            Tok::RBrace => write!(f, "}}"),
            Tok::LParen => write!(f, "("),
            Tok::RParen => write!(f, ")"),
            Tok::LBracket => write!(f, "["),
            Tok::RBracket => write!(f, "]"),
            Tok::Comma => write!(f, ","),
            Tok::Colon => write!(f, ":"),
            Tok::Semi => write!(f, ";"),
            Tok::Dot => write!(f, "."),
            Tok::Plus => write!(f, "+"),
            Tok::Minus => write!(f, "-"),
            Tok::Star => write!(f, "*"),
            Tok::Slash => write!(f, "/"),
            Tok::FatArrow => write!(f, "=>"),
            Tok::Eof => write!(f, "end of file"),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Token {
    pub tok: Tok,
    pub line: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LexError {
    pub message: String,
    pub line: u32,
}

impl fmt::Display for LexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

pub fn lex(source: &str) -> Result<Vec<Token>, LexError> {
    let chars: Vec<char> = source.chars().collect();
    let mut out = Vec::new();
    let mut i = 0usize;
    let mut line = 1u32;

    macro_rules! push {
        ($t:expr) => {{
            out.push(Token { tok: $t, line });
        }};
    }

    while i < chars.len() {
        let c = chars[i];

        if c == '\n' {
            line += 1;
            i += 1;
            continue;
        }
        if c.is_whitespace() {
            i += 1;
            continue;
        }

        // Comments.
        if c == '/' && i + 1 < chars.len() {
            if chars[i + 1] == '/' {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            if chars[i + 1] == '*' {
                i += 2;
                let mut closed = false;
                while i < chars.len() {
                    if chars[i] == '\n' {
                        line += 1;
                    }
                    if chars[i] == '*' && i + 1 < chars.len() && chars[i + 1] == '/' {
                        i += 2;
                        closed = true;
                        break;
                    }
                    i += 1;
                }
                if !closed {
                    return Err(LexError {
                        message: "unterminated block comment".into(),
                        line,
                    });
                }
                continue;
            }
        }

        // Strings.
        if c == '"' {
            i += 1;
            let mut s = String::new();
            let start_line = line;
            loop {
                if i >= chars.len() {
                    return Err(LexError {
                        message: "unterminated string".into(),
                        line: start_line,
                    });
                }
                match chars[i] {
                    '"' => {
                        i += 1;
                        break;
                    }
                    '\\' if i + 1 < chars.len() => {
                        let e = chars[i + 1];
                        s.push(match e {
                            'n' => '\n',
                            't' => '\t',
                            other => other,
                        });
                        i += 2;
                    }
                    ch => {
                        if ch == '\n' {
                            line += 1;
                        }
                        s.push(ch);
                        i += 1;
                    }
                }
            }
            push!(Tok::Str(s));
            continue;
        }

        // Numbers. A trailing `.` belongs to member access, not to the number.
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            let mut is_float = false;
            if i + 1 < chars.len() && chars[i] == '.' && chars[i + 1].is_ascii_digit() {
                is_float = true;
                i += 1;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
            }
            if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') {
                let mut j = i + 1;
                if j < chars.len() && (chars[j] == '+' || chars[j] == '-') {
                    j += 1;
                }
                if j < chars.len() && chars[j].is_ascii_digit() {
                    is_float = true;
                    i = j;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            let text: String = chars[start..i].iter().collect();
            if is_float {
                push!(Tok::Float(text.parse().map_err(|_| LexError {
                    message: format!("bad number '{text}'"),
                    line,
                })?));
            } else {
                match text.parse::<i64>() {
                    Ok(v) => push!(Tok::Int(v)),
                    // Out of integer range: keep it as a float rather than fail.
                    Err(_) => push!(Tok::Float(text.parse().map_err(|_| LexError {
                        message: format!("bad number '{text}'"),
                        line,
                    })?)),
                }
            }
            continue;
        }

        // Identifiers.
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            push!(Tok::Ident(chars[start..i].iter().collect()));
            continue;
        }

        // Module attributes.
        if c == '@' {
            i += 1;
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            if start == i {
                return Err(LexError {
                    message: "expected a name after '@'".into(),
                    line,
                });
            }
            push!(Tok::At(chars[start..i].iter().collect()));
            continue;
        }

        if c == '=' && i + 1 < chars.len() && chars[i + 1] == '>' {
            push!(Tok::FatArrow);
            i += 2;
            continue;
        }

        let simple = match c {
            '{' => Tok::LBrace,
            '}' => Tok::RBrace,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '[' => Tok::LBracket,
            ']' => Tok::RBracket,
            ',' => Tok::Comma,
            ':' => Tok::Colon,
            ';' => Tok::Semi,
            '.' => Tok::Dot,
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            other => {
                return Err(LexError {
                    message: format!("unexpected character '{other}'"),
                    line,
                })
            }
        };
        push!(simple);
        i += 1;
    }

    out.push(Token {
        tok: Tok::Eof,
        line,
    });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(src: &str) -> Vec<Tok> {
        lex(src).unwrap().into_iter().map(|t| t.tok).collect()
    }

    #[test]
    fn lexes_a_declaration() {
        assert_eq!(
            toks("label stroke(81 * units.mm)"),
            vec![
                Tok::Ident("label".into()),
                Tok::Ident("stroke".into()),
                Tok::LParen,
                Tok::Int(81),
                Tok::Star,
                Tok::Ident("units".into()),
                Tok::Dot,
                Tok::Ident("mm".into()),
                Tok::RParen,
                Tok::Eof,
            ]
        );
    }

    #[test]
    fn a_trailing_dot_is_member_access_not_a_decimal_point() {
        // `1.0.foo` never occurs, but `700.0` followed by `.add_sample` does.
        assert_eq!(
            toks("700.0 .add_sample"),
            vec![
                Tok::Float(700.0),
                Tok::Dot,
                Tok::Ident("add_sample".into()),
                Tok::Eof
            ]
        );
        assert_eq!(
            toks("c0.add_rod_journal"),
            vec![
                Tok::Ident("c0".into()),
                Tok::Dot,
                Tok::Ident("add_rod_journal".into()),
                Tok::Eof
            ]
        );
    }

    #[test]
    fn skips_comments_and_counts_lines() {
        let tokens = lex("// one\n/* two\nthree */\nx").unwrap();
        assert_eq!(tokens[0].tok, Tok::Ident("x".into()));
        assert_eq!(tokens[0].line, 4);
    }

    #[test]
    fn handles_strings_arrows_and_attributes() {
        assert_eq!(
            toks("@name: \"Actions\" => x"),
            vec![
                Tok::At("name".into()),
                Tok::Colon,
                Tok::Str("Actions".into()),
                Tok::FatArrow,
                Tok::Ident("x".into()),
                Tok::Eof,
            ]
        );
    }

    #[test]
    fn reports_where_things_went_wrong() {
        let err = lex("ok\n\"unterminated").unwrap_err();
        assert_eq!(err.line, 2);
        assert!(lex("a\n\n#").unwrap_err().line == 3);
    }
}
