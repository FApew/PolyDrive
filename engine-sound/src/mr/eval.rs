//! Evaluator.
//!
//! `.mr` is declarative: a node body may refer to something declared further
//! down, and the stock engine files rely on that (a cylinder bank is given a
//! head built from a camshaft that is instantiated fifty lines later). So
//! declarations are registered first and forced on demand, memoised, with cycle
//! detection.

use super::ast::*;
use super::builtins;
use super::value::{Instance, Object, ObjectRef, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;
use std::rc::Rc;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvalError {
    pub message: String,
}

impl fmt::Display for EvalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

pub fn err<T>(message: impl Into<String>) -> Result<T, EvalError> {
    Err(EvalError {
        message: message.into(),
    })
}

/// A declaration that has not been evaluated yet.
#[derive(Clone, Debug)]
enum Slot {
    Pending(Rc<PendingDecl>),
    /// Being forced right now — seeing this again means a cycle.
    InProgress,
    Ready(Value),
}

#[derive(Debug)]
struct PendingDecl {
    kind: DeclKind,
}

#[derive(Debug)]
enum DeclKind {
    Label(Expr),
    /// An input's default. Registered rather than evaluated up front because
    /// defaults may refer to inputs declared further down: the standard
    /// library's `exhaust_system_parameters` defines `length` as
    /// `volume / collector_cross_section_area`, and declares the area after it.
    Default(Expr),
    Instantiate {
        type_name: String,
        args: Vec<Arg>,
    },
    Output(Expr),
}

#[derive(Debug, Default)]
pub struct Scope {
    slots: RefCell<HashMap<String, Slot>>,
    parent: Option<Rc<Scope>>,
    /// Order matters only for error messages.
    node_name: String,
}

impl Scope {
    fn child(parent: &Rc<Scope>, node_name: &str) -> Rc<Scope> {
        Rc::new(Scope {
            slots: RefCell::new(HashMap::new()),
            parent: Some(parent.clone()),
            node_name: node_name.to_string(),
        })
    }

    fn set(&self, name: &str, value: Value) {
        self.slots
            .borrow_mut()
            .insert(name.to_string(), Slot::Ready(value));
    }

    fn declare(&self, name: &str, kind: DeclKind) {
        self.slots.borrow_mut().insert(
            name.to_string(),
            Slot::Pending(Rc::new(PendingDecl { kind })),
        );
    }

    fn has(&self, name: &str) -> bool {
        self.slots.borrow().contains_key(name)
    }
}

pub struct Interpreter {
    /// Node definitions by name, from every loaded file.
    nodes: HashMap<String, Rc<NodeDef>>,
    /// The scope holding file-level declarations (`units units()`).
    pub globals: Rc<Scope>,
    /// Set by `set_engine`.
    pub engine: RefCell<Option<ObjectRef>>,
    /// Set by `set_vehicle` and `set_transmission`. Only the gearing and the
    /// car's mass and drag reach the sound, but those do reach it.
    pub vehicle: RefCell<Option<ObjectRef>>,
    pub transmission: RefCell<Option<ObjectRef>>,
    depth: RefCell<u32>,
}

const MAX_DEPTH: u32 = 256;

impl Default for Interpreter {
    fn default() -> Self {
        Self::new()
    }
}

impl Interpreter {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            globals: Rc::new(Scope::default()),
            engine: RefCell::new(None),
            vehicle: RefCell::new(None),
            transmission: RefCell::new(None),
            depth: RefCell::new(0),
        }
    }

    /// Registers every node in a parsed file. Later definitions win, which is
    /// how a user file can shadow a standard-library part.
    pub fn add_file(&mut self, file: &File) {
        for def in &file.nodes {
            self.nodes.insert(def.name.clone(), Rc::new(def.clone()));
        }
    }

    /// Runs a file's top-level declarations.
    pub fn run_declarations(&self, file: &File) -> Result<(), EvalError> {
        let globals = self.globals.clone();
        self.register(&globals, &file.declarations);
        for stmt in &file.declarations {
            self.exec(&globals, stmt)?;
        }
        Ok(())
    }

    /// Instantiates a node by name with no arguments — the entry point for
    /// `main`.
    pub fn call_node(&self, name: &str) -> Result<Value, EvalError> {
        let scope = self.globals.clone();
        self.instantiate(&scope, name, &[])
    }

    // --- statements ------------------------------------------------------

    /// Registers declarations so they can be referred to before they appear.
    fn register(&self, scope: &Rc<Scope>, body: &[Stmt]) {
        for stmt in body {
            match stmt {
                Stmt::Label { name, value } => {
                    scope.declare(name, DeclKind::Label(value.clone()));
                }
                Stmt::Declare {
                    type_name,
                    name,
                    args,
                } => scope.declare(
                    name,
                    DeclKind::Instantiate {
                        type_name: type_name.clone(),
                        args: args.clone(),
                    },
                ),
                Stmt::Output {
                    name,
                    value: Some(value),
                    ..
                } => scope.declare(name, DeclKind::Output(value.clone())),
                _ => {}
            }
        }
    }

    fn exec(&self, scope: &Rc<Scope>, stmt: &Stmt) -> Result<(), EvalError> {
        match stmt {
            // Inputs are bound by the caller; outputs and declarations are
            // registered and forced on demand.
            Stmt::Input { .. } | Stmt::Output { .. } => Ok(()),
            Stmt::Label { name, .. } | Stmt::Declare { name, .. } => {
                self.lookup(scope, name)?;
                Ok(())
            }
            Stmt::Expr(expr) => {
                self.eval(scope, expr)?;
                Ok(())
            }
        }
    }

    // --- name resolution -------------------------------------------------

    fn lookup(&self, scope: &Rc<Scope>, name: &str) -> Result<Value, EvalError> {
        let mut current = Some(scope.clone());
        while let Some(s) = current {
            if s.has(name) {
                return self.force(&s, name);
            }
            current = s.parent.clone();
        }

        // A bare node name with no arguments, e.g. `constants` used as a value.
        if self.nodes.contains_key(name) {
            return self.instantiate(scope, name, &[]);
        }

        err(format!("`{name}` is not defined"))
    }

    fn force(&self, scope: &Rc<Scope>, name: &str) -> Result<Value, EvalError> {
        let slot = scope.slots.borrow().get(name).cloned();
        match slot {
            Some(Slot::Ready(v)) => Ok(v),
            Some(Slot::InProgress) => err(format!(
                "`{name}` depends on itself (in node `{}`)",
                scope.node_name
            )),
            Some(Slot::Pending(decl)) => {
                scope
                    .slots
                    .borrow_mut()
                    .insert(name.to_string(), Slot::InProgress);

                let scope_rc = scope.clone();
                let value = match &decl.kind {
                    DeclKind::Label(expr) | DeclKind::Output(expr) | DeclKind::Default(expr) => {
                        self.eval(&scope_rc, expr)
                    }
                    DeclKind::Instantiate { type_name, args } => {
                        self.instantiate(&scope_rc, type_name, args)
                    }
                };

                match value {
                    Ok(v) => {
                        scope.set(name, v.clone());
                        Ok(v)
                    }
                    Err(e) => {
                        // Leave the slot pending so a retry reports the same
                        // underlying problem rather than a bogus cycle.
                        scope
                            .slots
                            .borrow_mut()
                            .insert(name.to_string(), Slot::Pending(decl.clone()));
                        Err(e)
                    }
                }
            }
            None => err(format!("`{name}` is not defined")),
        }
    }

    // --- instantiation ---------------------------------------------------

    pub fn instantiate(
        &self,
        scope: &Rc<Scope>,
        type_name: &str,
        args: &[Arg],
    ) -> Result<Value, EvalError> {
        {
            let mut depth = self.depth.borrow_mut();
            *depth += 1;
            if *depth > MAX_DEPTH {
                return err(format!(
                    "nesting got too deep while building `{type_name}`; is there a cycle?"
                ));
            }
        }
        let result = self.instantiate_inner(scope, type_name, args);
        *self.depth.borrow_mut() -= 1;
        result
    }

    fn instantiate_inner(
        &self,
        scope: &Rc<Scope>,
        type_name: &str,
        args: &[Arg],
    ) -> Result<Value, EvalError> {
        let Some(def) = self.nodes.get(type_name).cloned() else {
            return err(format!(
                "`{type_name}` is not a known node type. \
                 A file that imports another of its own needs that file too, \
                 and one written for a newer engine-sim may use nodes this \
                 reader does not know."
            ));
        };

        // Evaluate arguments in the caller's scope.
        let mut positional = Vec::new();
        let mut named: HashMap<String, Value> = HashMap::new();
        for arg in args {
            let value = self.eval(scope, &arg.value)?;
            match &arg.name {
                Some(name) => {
                    named.insert(name.clone(), value);
                }
                None => positional.push(value),
            }
        }

        let inner = Scope::child(&self.globals, type_name);

        // Bind inputs: named first, then positional in declaration order.
        let input_names: Vec<&Stmt> = def
            .body
            .iter()
            .filter(|s| matches!(s, Stmt::Input { .. }))
            .collect();

        let mut next_positional = positional.into_iter();
        for stmt in &input_names {
            let Stmt::Input { name, default } = stmt else {
                continue;
            };
            if let Some(v) = named.remove(name) {
                inner.set(name, v);
            } else if let Some(v) = next_positional.next() {
                inner.set(name, v);
            } else if let Some(expr) = default {
                inner.declare(name, DeclKind::Default(expr.clone()));
            } else {
                inner.set(name, Value::Nil);
            }
        }

        if let Some(unknown) = named.keys().next() {
            return err(format!("`{type_name}` has no input called `{unknown}`"));
        }

        if let Some(native) = &def.native {
            return builtins::construct(self, native, &inner, &def);
        }

        // Register declarations, then run the body in order.
        self.register(&inner, &def.body);
        for stmt in &def.body {
            self.exec(&inner, stmt)?;
        }

        let alias = def.body.iter().find_map(|s| match s {
            Stmt::Output {
                name, alias: true, ..
            } => Some(name.clone()),
            _ => None,
        });

        // An alias output is what the instance *is*, so resolve straight to it.
        if let Some(alias_name) = &alias {
            if inner.has(alias_name) {
                return self.force(&inner, alias_name);
            }
        }

        Ok(Value::Instance(Rc::new(Instance {
            node_name: type_name.to_string(),
            scope: inner,
            alias: RefCell::new(alias),
        })))
    }

    // --- expressions -----------------------------------------------------

    pub fn eval(&self, scope: &Rc<Scope>, expr: &Expr) -> Result<Value, EvalError> {
        match expr {
            Expr::Float(v) => Ok(Value::Float(*v)),
            Expr::Int(v) => Ok(Value::Int(*v)),
            Expr::Str(s) => Ok(Value::Str(s.clone())),
            Expr::Bool(b) => Ok(Value::Bool(*b)),
            Expr::Ident(name) => self.lookup(scope, name),
            Expr::Negate(inner) => {
                let v = self.eval(scope, inner)?;
                match v {
                    Value::Int(i) => Ok(Value::Int(-i)),
                    other => match other.as_number() {
                        Some(n) => Ok(Value::Float(-n)),
                        None => err(format!("cannot negate {}", other.type_name())),
                    },
                }
            }
            Expr::Binary { op, lhs, rhs } => {
                let a = self.eval(scope, lhs)?;
                let b = self.eval(scope, rhs)?;
                binary(*op, a, b)
            }
            Expr::Member(target, name) => {
                let base = self.eval(scope, target)?;
                self.member(&base, name)
            }
            Expr::Call { callee, args } => self.call(scope, callee, args),
        }
    }

    fn member(&self, base: &Value, name: &str) -> Result<Value, EvalError> {
        match base {
            Value::Instance(instance) => {
                if instance.scope.has(name) {
                    self.force(&instance.scope, name)
                } else {
                    err(format!(
                        "`{}` has no output called `{name}`",
                        instance.node_name
                    ))
                }
            }
            Value::Object(object) => {
                let borrowed = object.borrow();
                match borrowed.props.get(name) {
                    Some(v) => Ok(v.clone()),
                    None => err(format!("`{}` has no property `{name}`", borrowed.kind)),
                }
            }
            other => err(format!("{} has no member `{name}`", other.type_name())),
        }
    }

    fn call(&self, scope: &Rc<Scope>, callee: &Expr, args: &[Arg]) -> Result<Value, EvalError> {
        // `target.method(args)` is sugar for `method(args, this: target)`, which
        // is how the standard library defines every `add_*` action.
        if let Expr::Member(target, method) = callee {
            let this = self.eval(scope, target)?;
            if self.nodes.contains_key(method.as_str()) {
                let mut all = args.to_vec();
                all.push(Arg {
                    name: Some("this".to_string()),
                    value: Expr::Ident(PRE_EVALUATED.to_string()),
                });
                let call_scope = Scope::child(scope, "call");
                call_scope.set(PRE_EVALUATED, this);
                return self.instantiate(&call_scope, method, &all);
            }
            // Otherwise it is a member that happens to be callable.
            let value = self.member(&this, method)?;
            return match value {
                Value::Nil => err(format!("`{method}` is not callable")),
                other => Ok(other),
            };
        }

        if let Expr::Ident(name) = callee {
            return self.instantiate(scope, name, args);
        }

        err("only names and members can be called".to_string())
    }
}

/// Scratch binding used to pass an already-evaluated receiver into a call.
const PRE_EVALUATED: &str = " this ";

fn binary(op: BinOp, a: Value, b: Value) -> Result<Value, EvalError> {
    // String concatenation, as used for engine names.
    if let (BinOp::Add, Value::Str(x), Value::Str(y)) = (op, &a, &b) {
        return Ok(Value::Str(format!("{x}{y}")));
    }

    let (Some(x), Some(y)) = (a.as_number(), b.as_number()) else {
        return err(format!(
            "cannot combine {} with {}",
            a.type_name(),
            b.type_name()
        ));
    };

    // Integer arithmetic stays integral, matching the language's typing.
    if let (Value::Int(i), Value::Int(j)) = (&a, &b) {
        let (i, j) = (*i, *j);
        return Ok(match op {
            BinOp::Add => Value::Int(i + j),
            BinOp::Sub => Value::Int(i - j),
            BinOp::Mul => Value::Int(i * j),
            BinOp::Div => {
                if j == 0 {
                    return err("division by zero");
                }
                Value::Int(i / j)
            }
        });
    }

    Ok(Value::Float(match op {
        BinOp::Add => x + y,
        BinOp::Sub => x - y,
        BinOp::Mul => x * y,
        BinOp::Div => {
            if y == 0.0 {
                return err("division by zero");
            }
            x / y
        }
    }))
}

/// Helper for builtins: read an input out of a node's scope.
pub fn input(interp: &Interpreter, scope: &Rc<Scope>, name: &str) -> Value {
    if scope.has(name) {
        interp.force(scope, name).unwrap_or(Value::Nil)
    } else {
        Value::Nil
    }
}

/// Collects every declared input of a native node into an object's properties.
pub fn collect_inputs(
    interp: &Interpreter,
    scope: &Rc<Scope>,
    def: &NodeDef,
    object: &ObjectRef,
) -> Result<(), EvalError> {
    for stmt in &def.body {
        if let Stmt::Input { name, .. } = stmt {
            let value = input(interp, scope, name);
            object.borrow_mut().props.insert(name.clone(), value);
        }
    }
    Ok(())
}

pub fn new_object(kind: &str) -> ObjectRef {
    Object::new(kind)
}
