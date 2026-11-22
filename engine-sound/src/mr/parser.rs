//! Recursive-descent parser for the `.mr` subset.

use super::ast::*;
use super::lexer::{lex, Tok, Token};
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
    pub line: u32,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

pub fn parse(source: &str) -> Result<File, ParseError> {
    let tokens = lex(source).map_err(|e| ParseError {
        message: e.message,
        line: e.line,
    })?;
    Parser { tokens, pos: 0 }.file()
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> &Tok {
        &self.tokens[self.pos].tok
    }

    fn peek_at(&self, offset: usize) -> &Tok {
        let i = (self.pos + offset).min(self.tokens.len() - 1);
        &self.tokens[i].tok
    }

    fn line(&self) -> u32 {
        self.tokens[self.pos].line
    }

    fn advance(&mut self) -> Tok {
        let t = self.tokens[self.pos].tok.clone();
        if self.pos + 1 < self.tokens.len() {
            self.pos += 1;
        }
        t
    }

    fn eat(&mut self, tok: &Tok) -> bool {
        if self.peek() == tok {
            self.advance();
            true
        } else {
            false
        }
    }

    fn expect(&mut self, tok: Tok) -> Result<(), ParseError> {
        if self.peek() == &tok {
            self.advance();
            Ok(())
        } else {
            Err(self.err(format!("expected `{tok}`, found `{}`", self.peek())))
        }
    }

    fn ident(&mut self) -> Result<String, ParseError> {
        match self.advance() {
            Tok::Ident(name) => Ok(name),
            other => Err(self.err(format!("expected a name, found `{other}`"))),
        }
    }

    fn err(&self, message: String) -> ParseError {
        ParseError {
            message,
            line: self.line(),
        }
    }

    fn is_keyword(&self, offset: usize, word: &str) -> bool {
        matches!(self.peek_at(offset), Tok::Ident(s) if s == word)
    }

    // --- file ------------------------------------------------------------

    fn file(&mut self) -> Result<File, ParseError> {
        let mut file = File {
            imports: Vec::new(),
            nodes: Vec::new(),
            declarations: Vec::new(),
        };

        loop {
            // `@doc: "..."` decorates the declaration that follows it. The
            // value may be several string literals written adjacently, which
            // the language joins.
            while matches!(self.peek(), Tok::At(_)) {
                self.advance();
                self.expect(Tok::Colon)?;
                self.expr()?;
                while matches!(self.peek(), Tok::Str(_)) {
                    self.advance();
                }
            }

            // Visibility modifiers apply to both imports and nodes.
            let mut public = false;
            let mut saw_visibility = false;
            if self.is_keyword(0, "private") || self.is_keyword(0, "public") {
                public = self.is_keyword(0, "public");
                saw_visibility = true;
                self.advance();
            }
            // `public inline node float { ... }`
            if self.is_keyword(0, "inline") {
                self.advance();
                saw_visibility = true;
            }

            match self.peek().clone() {
                Tok::Eof => break,
                Tok::Ident(word) if word == "import" => {
                    self.advance();
                    match self.advance() {
                        Tok::Str(path) => file.imports.push(path),
                        other => {
                            return Err(
                                self.err(format!("expected an import path, found `{other}`"))
                            )
                        }
                    }
                    self.eat(&Tok::Semi);
                }
                Tok::Ident(word) if word == "module" => {
                    self.advance();
                    self.skip_braced()?;
                }
                Tok::Ident(word) if word == "node" => {
                    self.advance();
                    let mut def = self.node_def()?;
                    def.public = public;
                    file.nodes.push(def);
                }
                Tok::Ident(_) if !saw_visibility => {
                    // A file-scope declaration, e.g. `units units()`.
                    file.declarations.push(self.stmt()?);
                }
                other => {
                    if saw_visibility {
                        return Err(self.err(format!(
                            "expected `node` or `import` after a visibility modifier, found `{other}`"
                        )));
                    }
                    return Err(self.err(format!("unexpected `{other}` at the top level")));
                }
            }
        }

        Ok(file)
    }

    /// Consumes a `{ ... }` block whose contents we do not need (module
    /// metadata).
    fn skip_braced(&mut self) -> Result<(), ParseError> {
        self.expect(Tok::LBrace)?;
        let mut depth = 1;
        loop {
            match self.advance() {
                Tok::LBrace => depth += 1,
                Tok::RBrace => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(());
                    }
                }
                Tok::Eof => return Err(self.err("unterminated block".into())),
                _ => {}
            }
        }
    }

    fn node_def(&mut self) -> Result<NodeDef, ParseError> {
        let name = self.ident()?;
        let native = if self.eat(&Tok::FatArrow) {
            Some(self.ident()?)
        } else {
            None
        };

        self.expect(Tok::LBrace)?;
        let mut body = Vec::new();
        while !self.eat(&Tok::RBrace) {
            if matches!(self.peek(), Tok::Eof) {
                return Err(self.err(format!("unterminated node `{name}`")));
            }
            body.push(self.stmt()?);
        }

        Ok(NodeDef {
            name,
            public: false,
            native,
            body,
        })
    }

    /// `[float]`, `[piston_channel]` — declared types, which the evaluator does
    /// not need.
    fn skip_type_annotation(&mut self) -> Result<(), ParseError> {
        if self.eat(&Tok::LBracket) {
            while !self.eat(&Tok::RBracket) {
                if matches!(self.peek(), Tok::Eof) {
                    return Err(self.err("unterminated type annotation".into()));
                }
                self.advance();
            }
        }
        Ok(())
    }

    fn stmt(&mut self) -> Result<Stmt, ParseError> {
        if self.is_keyword(0, "input") {
            self.advance();
            let name = self.ident()?;
            self.skip_type_annotation()?;
            let default = if self.eat(&Tok::Colon) {
                Some(self.expr()?)
            } else {
                None
            };
            self.eat(&Tok::Semi);
            return Ok(Stmt::Input { name, default });
        }

        let alias = if self.is_keyword(0, "alias") && self.is_keyword(1, "output") {
            self.advance();
            true
        } else {
            false
        };

        if self.is_keyword(0, "output") {
            self.advance();
            let name = self.ident()?;
            self.skip_type_annotation()?;
            let value = if self.eat(&Tok::Colon) {
                Some(self.expr()?)
            } else {
                None
            };
            self.eat(&Tok::Semi);
            return Ok(Stmt::Output { name, alias, value });
        }

        if self.is_keyword(0, "label") {
            self.advance();
            let name = self.ident()?;
            self.expect(Tok::LParen)?;
            let value = self.expr()?;
            self.expect(Tok::RParen)?;
            self.eat(&Tok::Semi);
            return Ok(Stmt::Label { name, value });
        }

        // `TypeName varName(args)` declares an instance; anything else starting
        // with an identifier is an expression, typically a method chain.
        if matches!(self.peek(), Tok::Ident(_))
            && matches!(self.peek_at(1), Tok::Ident(_))
            && matches!(self.peek_at(2), Tok::LParen)
        {
            let type_name = self.ident()?;
            let name = self.ident()?;
            let args = self.call_args()?;
            self.eat(&Tok::Semi);
            return Ok(Stmt::Declare {
                type_name,
                name,
                args,
            });
        }

        let expr = self.expr()?;
        self.eat(&Tok::Semi);
        Ok(Stmt::Expr(expr))
    }

    // --- expressions -----------------------------------------------------

    fn expr(&mut self) -> Result<Expr, ParseError> {
        self.additive()
    }

    fn additive(&mut self) -> Result<Expr, ParseError> {
        let mut lhs = self.multiplicative()?;
        loop {
            let op = match self.peek() {
                Tok::Plus => BinOp::Add,
                Tok::Minus => BinOp::Sub,
                _ => break,
            };
            self.advance();
            let rhs = self.multiplicative()?;
            lhs = Expr::Binary {
                op,
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
            };
        }
        Ok(lhs)
    }

    fn multiplicative(&mut self) -> Result<Expr, ParseError> {
        let mut lhs = self.unary()?;
        loop {
            let op = match self.peek() {
                Tok::Star => BinOp::Mul,
                Tok::Slash => BinOp::Div,
                _ => break,
            };
            self.advance();
            let rhs = self.unary()?;
            lhs = Expr::Binary {
                op,
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
            };
        }
        Ok(lhs)
    }

    fn unary(&mut self) -> Result<Expr, ParseError> {
        if self.eat(&Tok::Minus) {
            return Ok(Expr::Negate(Box::new(self.unary()?)));
        }
        if self.eat(&Tok::Plus) {
            return self.unary();
        }
        self.postfix()
    }

    fn postfix(&mut self) -> Result<Expr, ParseError> {
        let mut expr = self.primary()?;
        loop {
            if self.eat(&Tok::Dot) {
                expr = Expr::Member(Box::new(expr), self.ident()?);
            } else if matches!(self.peek(), Tok::LParen) {
                let args = self.call_args()?;
                expr = Expr::Call {
                    callee: Box::new(expr),
                    args,
                };
            } else {
                return Ok(expr);
            }
        }
    }

    fn call_args(&mut self) -> Result<Vec<Arg>, ParseError> {
        self.expect(Tok::LParen)?;
        let mut args = Vec::new();
        if self.eat(&Tok::RParen) {
            return Ok(args);
        }
        loop {
            // `name: value` versus a positional expression.
            let name =
                if matches!(self.peek(), Tok::Ident(_)) && matches!(self.peek_at(1), Tok::Colon) {
                    let n = self.ident()?;
                    self.advance(); // colon
                    Some(n)
                } else {
                    None
                };
            let value = self.expr()?;
            args.push(Arg { name, value });

            if self.eat(&Tok::Comma) {
                // A trailing comma before `)` is allowed.
                if self.eat(&Tok::RParen) {
                    return Ok(args);
                }
                continue;
            }
            self.expect(Tok::RParen)?;
            return Ok(args);
        }
    }

    fn primary(&mut self) -> Result<Expr, ParseError> {
        match self.advance() {
            Tok::Float(v) => Ok(Expr::Float(v)),
            Tok::Int(v) => Ok(Expr::Int(v)),
            Tok::Str(s) => Ok(Expr::Str(s)),
            Tok::Ident(name) => match name.as_str() {
                "true" => Ok(Expr::Bool(true)),
                "false" => Ok(Expr::Bool(false)),
                _ => Ok(Expr::Ident(name)),
            },
            Tok::LParen => {
                let inner = self.expr()?;
                self.expect(Tok::RParen)?;
                Ok(inner)
            }
            other => Err(self.err(format!("expected a value, found `{other}`"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_node_with_inputs_and_outputs() {
        let file = parse(
            r#"
            private node head {
                input chamber_volume: 90 * units.cc;
                input flip_display: false;
                alias output __out: h;

                generic_cylinder_head h(chamber_volume: chamber_volume)
            }
            "#,
        )
        .unwrap();

        assert_eq!(file.nodes.len(), 1);
        let body = &file.nodes[0].body;
        assert!(
            matches!(&body[0], Stmt::Input { name, default: Some(_) } if name == "chamber_volume")
        );
        assert!(
            matches!(&body[2], Stmt::Output { alias: true, name, value: Some(_) } if name == "__out")
        );
        assert!(matches!(&body[3], Stmt::Declare { type_name, name, .. }
            if type_name == "generic_cylinder_head" && name == "h"));
    }

    #[test]
    fn parses_method_chains() {
        let file =
            parse("public node main { c0.add_rod_journal(rj0).add_rod_journal(rj1) }").unwrap();
        let Stmt::Expr(Expr::Call { callee, args }) = &file.nodes[0].body[0] else {
            panic!("expected a call");
        };
        assert_eq!(args.len(), 1);
        assert!(matches!(&**callee, Expr::Member(_, m) if m == "add_rod_journal"));
    }

    #[test]
    fn parses_native_bindings_and_type_annotations() {
        let file = parse(
            "private node _piston => __engine_sim__piston {\n\
                 input mass [float]: 0.0;\n\
                 alias output __out [piston_channel];\n\
             }",
        )
        .unwrap();
        assert_eq!(
            file.nodes[0].native.as_deref(),
            Some("__engine_sim__piston")
        );
        assert!(matches!(
            &file.nodes[0].body[1],
            Stmt::Output {
                alias: true,
                value: None,
                ..
            }
        ));
    }

    #[test]
    fn honours_operator_precedence() {
        let file = parse("public node m { label x(1 + 2 * 3) }").unwrap();
        let Stmt::Label { value, .. } = &file.nodes[0].body[0] else {
            panic!()
        };
        let Expr::Binary { op, rhs, .. } = value else {
            panic!()
        };
        assert_eq!(*op, BinOp::Add);
        assert!(matches!(&**rhs, Expr::Binary { op: BinOp::Mul, .. }));
    }

    #[test]
    fn skips_module_metadata_and_records_imports() {
        let file = parse(
            "module {\n  @name: \"Actions\"\n  @author: \"ATG\"\n}\n\
             private import \"../types/atomic_types.mr\"\n\
             public import \"units.mr\"\n\
             public node a { }",
        )
        .unwrap();
        assert_eq!(file.imports.len(), 2);
        assert_eq!(file.nodes.len(), 1);
        assert!(file.nodes[0].public);
    }

    #[test]
    fn parses_file_scope_declarations_and_doc_attributes() {
        let file = parse(
            "units units()
             constants constants()
             @doc: \"a channel\"
             private node float_channel => __engine_sim__float { }",
        )
        .unwrap();
        assert_eq!(file.declarations.len(), 2);
        assert!(
            matches!(&file.declarations[0], Stmt::Declare { type_name, name, .. }
            if type_name == "units" && name == "units")
        );
        assert_eq!(file.nodes.len(), 1);
    }

    #[test]
    fn reports_the_line_of_a_syntax_error() {
        let err = parse("public node a {\n\n  input\n}").unwrap_err();
        assert_eq!(err.line, 4);
    }
}
