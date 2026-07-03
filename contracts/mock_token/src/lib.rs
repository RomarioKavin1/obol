#![no_std]
//! Obol mock SEP-41 token.
//!
//! A minimal, mint-able fungible token implementing the Soroban token
//! (SEP-41) interface, used to make demos and tests self-contained (e.g. a mock
//! USDC-style stablecoin held in inheritance vaults and staked by keepers).
//!
//! Deliberately insecure by design: besides the admin-only `mint`, there is a
//! permissionless `faucet` that mints a fixed batch to anyone. Not for
//! production use.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, MuxedAddress, String,
};

const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND: u32 = 1_000_000;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    InsufficientBalance = 2,
    InsufficientAllowance = 3,
    InvalidAmount = 4,
    NotAdmin = 5,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Decimals,
    Name,
    Symbol,
    Balance(Address),
    Allowance(AllowanceKey),
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn __constructor(
        env: Env,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Result<(), Error> {
        let s = env.storage().instance();
        if s.has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Decimals, &decimal);
        s.set(&DataKey::Name, &name);
        s.set(&DataKey::Symbol, &symbol);
        Ok(())
    }

    /// Admin-only mint. Also usable in demos to fund test accounts.
    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::AlreadyInitialized)?;
        admin.require_auth();
        if amount < 0 {
            return Err(Error::InvalidAmount);
        }
        let bal = read_balance(&env, &to);
        write_balance(&env, &to, bal + amount);
        Ok(())
    }

    /// Permissionless demo faucet: anyone can mint a fixed batch of test tokens
    /// to `to` (the caller signs + pays the fee). Makes the demo self-contained.
    /// NOT for production use.
    pub fn faucet(env: Env, to: Address) -> i128 {
        // 10,000 tokens at 7 decimals.
        let amount: i128 = 100_000_000_000;
        let bal = read_balance(&env, &to);
        write_balance(&env, &to, bal + amount);
        amount
    }
}

// SEP-41 / Soroban token interface.
#[contractimpl]
impl token::Interface for MockToken {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let key = DataKey::Allowance(AllowanceKey { from, spender });
        match env.storage().temporary().get::<_, AllowanceValue>(&key) {
            Some(v) if v.expiration_ledger >= env.ledger().sequence() => v.amount,
            _ => 0,
        }
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        let key = DataKey::Allowance(AllowanceKey {
            from,
            spender,
        });
        env.storage().temporary().set(
            &key,
            &AllowanceValue {
                amount,
                expiration_ledger,
            },
        );
        if amount > 0 {
            env.storage()
                .temporary()
                .extend_ttl(&key, expiration_ledger, expiration_ledger);
        }
    }

    fn balance(env: Env, id: Address) -> i128 {
        read_balance(&env, &id)
    }

    fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        do_transfer(&env, &from, &to.address(), amount);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        spend_allowance(&env, &from, &spender, amount);
        do_transfer(&env, &from, &to, amount);
    }

    fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let bal = read_balance(&env, &from);
        assert!(bal >= amount, "insufficient balance");
        write_balance(&env, &from, bal - amount);
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        spend_allowance(&env, &from, &spender, amount);
        let bal = read_balance(&env, &from);
        assert!(bal >= amount, "insufficient balance");
        write_balance(&env, &from, bal - amount);
    }

    fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Decimals).unwrap_or(7)
    }

    fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "Mock"))
    }

    fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "MOCK"))
    }
}

fn read_balance(env: &Env, id: &Address) -> i128 {
    env.storage().persistent().get(&DataKey::Balance(id.clone())).unwrap_or(0)
}

fn write_balance(env: &Env, id: &Address, amount: i128) {
    let key = DataKey::Balance(id.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
}

fn do_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    assert!(amount >= 0, "negative amount");
    let from_bal = read_balance(env, from);
    assert!(from_bal >= amount, "insufficient balance");
    write_balance(env, from, from_bal - amount);
    let to_bal = read_balance(env, to);
    write_balance(env, to, to_bal + amount);
}

fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
    let key = DataKey::Allowance(AllowanceKey {
        from: from.clone(),
        spender: spender.clone(),
    });
    let allowance: AllowanceValue = env
        .storage()
        .temporary()
        .get(&key)
        .unwrap_or(AllowanceValue {
            amount: 0,
            expiration_ledger: 0,
        });
    assert!(
        allowance.amount >= amount && allowance.expiration_ledger >= env.ledger().sequence(),
        "insufficient allowance"
    );
    env.storage().temporary().set(
        &key,
        &AllowanceValue {
            amount: allowance.amount - amount,
            expiration_ledger: allowance.expiration_ledger,
        },
    );
}
