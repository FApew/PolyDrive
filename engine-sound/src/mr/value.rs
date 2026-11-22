//! Runtime values.
//!
//! Engine-sim's object model is represented generically — a kind tag plus a
//! property bag — rather than as thirty concrete structs. The mapping into an
//! [`crate::config::EngineConfig`] reads the bag once at the end, so there is
//! nothing to be gained from typing each object on the way in, and a great deal
//! of code to be saved.

use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;
use std::rc::Rc;

pub type ObjectRef = Rc<RefCell<Object>>;

#[derive(Clone, Debug, Default)]
pub struct Object {
    pub kind: String,
    pub props: HashMap<String, Value>,
    /// Things attached by the `add_*` actions, in the order they were added.
    pub lists: HashMap<String, Vec<Value>>,
}

impl Object {
    pub fn new(kind: &str) -> ObjectRef {
        Rc::new(RefCell::new(Object {
            kind: kind.to_string(),
            ..Default::default()
        }))
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.props.get(key)
    }

    pub fn number(&self, key: &str) -> Option<f64> {
        self.props.get(key).and_then(Value::as_number)
    }

    pub fn number_or(&self, key: &str, fallback: f64) -> f64 {
        self.number(key).unwrap_or(fallback)
    }

    pub fn bool_or(&self, key: &str, fallback: bool) -> bool {
        match self.props.get(key) {
            Some(Value::Bool(b)) => *b,
            _ => fallback,
        }
    }

    pub fn string(&self, key: &str) -> Option<String> {
        match self.props.get(key) {
            Some(Value::Str(s)) => Some(s.clone()),
            _ => None,
        }
    }

    pub fn object(&self, key: &str) -> Option<ObjectRef> {
        match self.props.get(key) {
            Some(Value::Object(o)) => Some(o.clone()),
            _ => None,
        }
    }

    pub fn list(&self, key: &str) -> &[Value] {
        self.lists.get(key).map(Vec::as_slice).unwrap_or(&[])
    }

    pub fn objects(&self, key: &str) -> Vec<ObjectRef> {
        self.list(key)
            .iter()
            .filter_map(|v| match v {
                Value::Object(o) => Some(o.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn push(&mut self, key: &str, value: Value) {
        self.lists.entry(key.to_string()).or_default().push(value);
    }
}

#[derive(Clone, Debug, Default)]
pub enum Value {
    #[default]
    Nil,
    Float(f64),
    Int(i64),
    Bool(bool),
    Str(String),
    Object(ObjectRef),
    /// An instance of a user-defined node, carrying its evaluated scope.
    Instance(Rc<Instance>),
}

impl Value {
    pub fn as_number(&self) -> Option<f64> {
        match self {
            Value::Float(v) => Some(*v),
            Value::Int(v) => Some(*v as f64),
            Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<ObjectRef> {
        match self {
            Value::Object(o) => Some(o.clone()),
            _ => None,
        }
    }

    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Nil => "nothing",
            Value::Float(_) => "a number",
            Value::Int(_) => "an integer",
            Value::Bool(_) => "a boolean",
            Value::Str(_) => "a string",
            Value::Object(_) => "an object",
            Value::Instance(_) => "a node",
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Nil => write!(f, "nothing"),
            Value::Float(v) => write!(f, "{v}"),
            Value::Int(v) => write!(f, "{v}"),
            Value::Bool(b) => write!(f, "{b}"),
            Value::Str(s) => write!(f, "{s}"),
            Value::Object(o) => write!(f, "<{}>", o.borrow().kind),
            Value::Instance(i) => write!(f, "<node {}>", i.node_name),
        }
    }
}

/// An evaluated user-defined node: its outputs, resolved on demand.
#[derive(Debug)]
pub struct Instance {
    pub node_name: String,
    pub scope: Rc<super::eval::Scope>,
    /// The `alias output` name, if the node has one. Referring to the instance
    /// as a value means referring to this output.
    pub alias: RefCell<Option<String>>,
}
