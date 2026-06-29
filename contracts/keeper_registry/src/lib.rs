#![no_std]
//! Obol KeeperRegistry
//!
//! Keepers are the watchers of the dead-man's-switch: they call
//! `report_missed` on the LivenessRegistry when an owner goes silent. To align
//! incentives and deter spam, keepers stake tokens here. `is_active_keeper`
//! gates who is considered a bonded keeper (front-ends / off-chain agents check
//! this before acting).

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env,
};

const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND: u32 = 1_000_000;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    InsufficientStake = 2,
    InsufficientBalance = 3,
    InvalidAmount = 4,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    MinStake,
    TotalStaked,
    Stake(Address),
}

#[contractevent(topics = ["staked"], data_format = "map")]
pub struct Staked {
    #[topic]
    pub keeper: Address,
    pub amount: i128,
    pub total: i128,
}

#[contractevent(topics = ["unstaked"], data_format = "map")]
pub struct Unstaked {
    #[topic]
    pub keeper: Address,
    pub amount: i128,
    pub remaining: i128,
}

#[contract]
pub struct KeeperRegistry;

#[contractimpl]
impl KeeperRegistry {
    /// Deploy-time init. `min_stake` is the bond required to be an active keeper.
    pub fn __constructor(env: Env, stake_token: Address, min_stake: i128) -> Result<(), Error> {
        let s = env.storage().instance();
        if s.has(&DataKey::Token) {
            return Err(Error::AlreadyInitialized);
        }
        s.set(&DataKey::Token, &stake_token);
        s.set(&DataKey::MinStake, &min_stake);
        s.set(&DataKey::TotalStaked, &0i128);
        Ok(())
    }

    /// Bond `amount` tokens as `keeper`. Must bring the stake to at least the
    /// minimum on the first stake.
    pub fn stake(env: Env, keeper: Address, amount: i128) -> Result<i128, Error> {
        keeper.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let s = env.storage().instance();
        let min_stake: i128 = s.get(&DataKey::MinStake).unwrap_or(0);
        let current: i128 = s.get(&DataKey::Stake(keeper.clone())).unwrap_or(0);
        let new_total = current + amount;
        if new_total < min_stake {
            return Err(Error::InsufficientStake);
        }

        let token_addr: Address = s.get(&DataKey::Token).ok_or(Error::AlreadyInitialized)?;
        let client = token::Client::new(&env, &token_addr);
        client.transfer(&keeper, &env.current_contract_address(), &amount);

        s.set(&DataKey::Stake(keeper.clone()), &new_total);
        let total: i128 = s.get(&DataKey::TotalStaked).unwrap_or(0);
        s.set(&DataKey::TotalStaked, &(total + amount));
        bump(&env);

        Staked {
            keeper,
            amount,
            total: new_total,
        }
        .publish(&env);
        Ok(new_total)
    }

    /// Withdraw `amount` of the keeper's stake.
    pub fn unstake(env: Env, keeper: Address, amount: i128) -> Result<i128, Error> {
        keeper.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let s = env.storage().instance();
        let current: i128 = s.get(&DataKey::Stake(keeper.clone())).unwrap_or(0);
        if amount > current {
            return Err(Error::InsufficientBalance);
        }
        let remaining = current - amount;

        let token_addr: Address = s.get(&DataKey::Token).ok_or(Error::AlreadyInitialized)?;
        let client = token::Client::new(&env, &token_addr);
        client.transfer(&env.current_contract_address(), &keeper, &amount);

        s.set(&DataKey::Stake(keeper.clone()), &remaining);
        let total: i128 = s.get(&DataKey::TotalStaked).unwrap_or(0);
        s.set(&DataKey::TotalStaked, &(total - amount));
        bump(&env);

        Unstaked {
            keeper,
            amount,
            remaining,
        }
        .publish(&env);
        Ok(remaining)
    }

    pub fn get_stake(env: Env, keeper: Address) -> i128 {
        env.storage().instance().get(&DataKey::Stake(keeper)).unwrap_or(0)
    }
    pub fn is_active_keeper(env: Env, keeper: Address) -> bool {
        let s = env.storage().instance();
        let min_stake: i128 = s.get(&DataKey::MinStake).unwrap_or(0);
        let staked: i128 = s.get(&DataKey::Stake(keeper)).unwrap_or(0);
        staked >= min_stake && min_stake > 0
    }
    pub fn get_min_stake(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::MinStake).unwrap_or(0)
    }
    pub fn get_total_staked(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0)
    }
}

fn bump(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
}
