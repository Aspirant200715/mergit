//! Needs `anvil`, `forge` and the mergit-contracts repository next to this one (or MERGIT_CONTRACTS_DIR).
#![cfg(feature = "testkit")]

use mergit_chain_client::testkit::Chain;

#[tokio::test]
async fn testkit_deploys_and_client_reads_roles_and_window() {
    let chain = Chain::start().await;
    let c = chain.contracts(chain.keys.gateway.clone());
    assert_eq!(c.escrow.window().call().await.unwrap(), 600);
    let gateway_role = c.escrow.GATEWAY_ROLE().call().await.unwrap();
    assert!(
        c.escrow
            .hasRole(gateway_role, chain.keys.gateway.address())
            .call()
            .await
            .unwrap()
    );
    assert_eq!(chain.deployment.chain_id, 31337);
}

#[tokio::test]
async fn registered_agent_is_readable_through_the_client() {
    let chain = Chain::start().await;
    let agent = chain.register_agent().await;
    let c = chain.contracts(chain.keys.gateway.clone());
    assert_eq!(
        c.identity
            .runtimeKeyOf(agent.agent_id)
            .call()
            .await
            .unwrap(),
        agent.runtime.address()
    );
    assert_eq!(
        c.identity.operatorOf(agent.agent_id).call().await.unwrap(),
        agent.operator.address()
    );
}
