"""Known model windows reach pickers without inventing limits for unknown models."""

import time

from agent import models_dev
from hermes_cli import inventory


def test_catalog_windows_and_unknown_models(monkeypatch):
    """Cached catalog sizes are exported; the unknown-model safety default is not."""
    monkeypatch.setattr(models_dev, "_models_dev_cache", {
        "openai": {"models": {"known": {"limit": {"context": 128000}}}},
    })
    monkeypatch.setattr(models_dev, "_models_dev_cache_time", time.time())
    monkeypatch.setattr("hermes_cli.config.load_config_readonly", dict)
    rows = [{"slug": "openai", "models": ["known", "unknown"]}]

    inventory._apply_capabilities(rows, metadata_config={})

    assert rows[0]["capabilities"]["known"]["context_window"] == 128000
    assert "context_window" not in rows[0]["capabilities"]["unknown"]


def test_configured_window_wins_over_catalog(monkeypatch):
    """An explicit context override follows the same resolution as the agent."""
    config = {"model_overrides": {"openai": {"known": {"context_window": 32000}}}}
    monkeypatch.setattr(models_dev, "_models_dev_cache", {
        "openai": {"models": {"known": {"limit": {"context": 128000}}}},
    })
    monkeypatch.setattr(models_dev, "_models_dev_cache_time", time.time())
    monkeypatch.setattr("hermes_cli.config.load_config_readonly", lambda: config)
    rows = [{"slug": "openai", "models": ["known"]}]

    inventory._apply_capabilities(rows, metadata_config=config)

    assert rows[0]["capabilities"]["known"]["context_window"] == 32000
