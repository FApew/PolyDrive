//! Syntax tree for the `.mr` subset.

#[derive(Clone, Debug)]
pub enum Expr {
    Float(f64),
    Int(i64),
    Str(String),
    Bool(bool),
    Ident(String),
    /// `intake.plenum_volume`, `camshaft.intake_cam_0`
    Member(Box<Expr>, String),
    /// `k_carb(700.0)`, `piston(params, blowby: k)`
    Call {
        callee: Box<Expr>,
        args: Vec<Arg>,
    },
    Binary {
        op: BinOp,
        lhs: Box<Expr>,
        rhs: Box<Expr>,
    },
    Negate(Box<Expr>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
}

#[derive(Clone, Debug)]
pub struct Arg {
    /// `None` for positional arguments.
    pub name: Option<String>,
    pub value: Expr,
}

#[derive(Clone, Debug)]
pub enum Stmt {
    /// `input chamber_volume: 90 * units.cc;`
    Input { name: String, default: Option<Expr> },
    /// `output intake_cam_0: _intake_cam_0;` / `alias output __out: head;`
    ///
    /// A node bound to a native implementation declares its outputs with a type
    /// and no expression (`alias output __out [piston_channel];`); the value is
    /// then the native object itself.
    Output {
        name: String,
        alias: bool,
        value: Option<Expr>,
    },
    /// `label stroke(81 * units.mm)`
    Label { name: String, value: Expr },
    /// `crankshaft c0(throw: stroke / 2, ...)`
    Declare {
        type_name: String,
        name: String,
        args: Vec<Arg>,
    },
    /// A bare expression, which is how method chains like
    /// `c0.add_rod_journal(rj0).add_rod_journal(rj1)` are written.
    Expr(Expr),
}

#[derive(Clone, Debug)]
pub struct NodeDef {
    pub name: String,
    pub public: bool,
    /// `node k_carb => __engine_sim__k_carb { ... }`
    pub native: Option<String>,
    pub body: Vec<Stmt>,
}

#[derive(Clone, Debug)]
pub struct File {
    pub imports: Vec<String>,
    pub nodes: Vec<NodeDef>,
    /// File-scope declarations such as `units units()`, which every module uses
    /// to bring the unit and constant tables into scope.
    pub declarations: Vec<Stmt>,
}
