use alloy_primitives::Address;
use alloy_sol_types::{Eip712Domain, eip712_domain, sol};

sol! {
    /// The signed commitment. Matches the typehash in ReceiptRegistry.
    #[derive(Debug, PartialEq, Eq)]
    struct Receipt {
        bytes32 taskId;
        bytes32 root;
        bytes32 terminalHash;
        bytes32 bodyHash;
        uint256 costMicros;
    }
}

/// `{name: "Mergit", version: "0", chainId, verifyingContract: ReceiptRegistry}`.
pub fn receipt_domain(chain_id: u64, registry: Address) -> Eip712Domain {
    eip712_domain! {
        name: "Mergit",
        version: "0",
        chain_id: chain_id,
        verifying_contract: registry,
    }
}
