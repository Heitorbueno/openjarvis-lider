"""Ensure the PWA's voice token budget is used by the local server agent."""
from __future__ import annotations

from openjarvis.agents._stubs import AgentResult
from openjarvis.server.models import ChatCompletionRequest, ChatMessage
from openjarvis.server.routes import _handle_agent


class _CapturingAgent:
    _model = "local-default"
    _max_tokens = 2048

    def __init__(self):
        self.seen = []

    def run(self, text, context=None):
        self.seen.append((self._model, self._max_tokens, text))
        return AgentResult(content="Previsão de Cuiabá: consulte a fonte.")


def test_explicit_voice_budget_is_honored_and_restored():
    agent = _CapturingAgent()
    req = ChatCompletionRequest(
        model="qwen3.5:2b-q4_K_M",
        messages=[ChatMessage(role="user", content="Responda em voz")],
        max_tokens=360,
        stream=True,
    )
    response = _handle_agent(agent, req.model, req)
    assert agent.seen == [("qwen3.5:2b-q4_K_M", 360, "Responda em voz")]
    assert agent._max_tokens == 2048
    assert agent._model == "local-default"
    assert response.choices[0].message.content.startswith("Previsão de Cuiabá")


def test_implicit_limit_retains_agent_default():
    agent = _CapturingAgent()
    req = ChatCompletionRequest(
        model="qwen3.5:2b-q4_K_M",
        messages=[ChatMessage(role="user", content="Explique tudo")],
    )
    _handle_agent(agent, req.model, req)
    assert agent.seen[0][1] == 2048
    assert agent._max_tokens == 2048
