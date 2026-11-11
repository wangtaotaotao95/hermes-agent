"""Uninitialized Bot Chat stores are absent, not broken query targets (#153048)."""
import sqlite3
from types import SimpleNamespace

import pytest

from tools import bot_live_delivery as mailbox


@pytest.mark.parametrize("store_state", ["absent", "directory", "empty", "ready"])
def test_owner_discovery_does_not_initialize_unready_stores(tmp_path, monkeypatch, store_state):
    import hermes_cli.gateway_runtime as runtime
    from hermes_state import SessionDB

    monkeypatch.setattr(runtime, "discover_gateway_endpoint", lambda home, timeout: SimpleNamespace(
        state="ready", endpoint=SimpleNamespace(instance_id="test-authority")))
    path = tmp_path / "state.db"
    if store_state == "directory":
        path.mkdir()
    elif store_state == "empty":
        path.touch()
    elif store_state == "ready":
        db = SessionDB(db_path=path)
        db.create_session(session_id="chat", source="cli")
        db.set_session_title("chat", "Bot Chat")
        db.close()
    before = path.read_bytes() if path.is_file() else None
    assert mailbox._bot_chat_tip(tmp_path) == ("chat" if store_state == "ready" else None)
    owner = mailbox.find_canonical_live_owner(tmp_path)
    if store_state == "ready":
        assert owner["session_id"] == owner["live_session_id"] == "chat"
        assert owner["lease_id"] == "test-authority"
    else:
        assert owner is None
    assert (path.read_bytes() if path.is_file() else None) == before
    if store_state == "absent":
        assert not path.exists()


@pytest.mark.parametrize("lookup", [mailbox._bot_chat_tip, mailbox.find_canonical_live_owner])
def test_nonempty_corruption_is_not_treated_as_an_absent_store(tmp_path, monkeypatch, lookup):
    import hermes_cli.gateway_runtime as runtime

    monkeypatch.setattr(runtime, "discover_gateway_endpoint", lambda home, timeout: SimpleNamespace(
        state="ready", endpoint=SimpleNamespace(instance_id="test-authority")))
    path = tmp_path / "state.db"
    path.write_bytes(b"synthetic corrupt sqlite database")
    with pytest.raises(sqlite3.DatabaseError):
        lookup(tmp_path)
    assert path.read_bytes() == b"synthetic corrupt sqlite database"
