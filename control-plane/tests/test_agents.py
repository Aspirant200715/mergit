from pathlib import Path

import pytest

from mergit_cp.agents import Agent, load_agents


def test_load_agents_joins_chain_ids_with_model_config(agents_files: tuple[Path, Path]) -> None:
    chain, config = agents_files
    assert load_agents(str(chain), str(config)) == [
        Agent(
            agent_id="1",
            name="coder-a",
            operator="0x1111111111111111111111111111111111111111",
            runtime_key="0x2222222222222222222222222222222222222222",
            model="claude-sonnet-5",
            system_prompt="You fix failing tests.",
        )
    ]


def test_agent_without_model_config_fails_loudly(agents_files: tuple[Path, Path]) -> None:
    chain, config = agents_files
    config.write_text('[agents.someone-else]\nmodel = "m"\nsystem_prompt = "p"\n')
    with pytest.raises(ValueError, match="coder-a"):
        load_agents(str(chain), str(config))


def test_rejects_non_decimal_agent_id(agents_files: tuple[Path, Path]) -> None:
    chain, config = agents_files
    chain.write_text(chain.read_text().replace('"agent_id": "1"', '"agent_id": "0x1"'))
    with pytest.raises(ValueError):
        load_agents(str(chain), str(config))


def test_rejects_duplicate_agent_id(agents_files: tuple[Path, Path]) -> None:
    chain, config = agents_files
    one = chain.read_text()
    entry = one[one.index("[") + 1 : one.rindex("]")]
    chain.write_text('{"agents": [' + entry + "," + entry + "]}")
    with pytest.raises(ValueError, match="duplicate"):
        load_agents(str(chain), str(config))


def test_shipped_config_covers_the_deploy_example_agents() -> None:
    root = Path(__file__).resolve().parents[1]
    agents = load_agents(str(root.parent / "deploy" / "agents.example.json"), str(root / "agents.toml"))
    assert [a.agent_id for a in agents] == ["1", "2"]
    assert all(a.model and a.system_prompt for a in agents)


def test_flat_tables_are_rejected(agents_files: tuple[Path, Path]) -> None:
    chain, config = agents_files
    config.write_text('[coder-a]\nmodel = "m"\nsystem_prompt = "p"\n')
    with pytest.raises(ValueError, match="agents"):
        load_agents(str(chain), str(config))
