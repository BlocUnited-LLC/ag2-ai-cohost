import asyncio
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from ag2.context import ConversationContext
from ag2.events import BaseEvent, TaskCompleted, TaskStarted, ToolCallEvent, ToolResultEvent
from ag2.stream import MemoryStream
from ag2.usage import Usage
from openai import AsyncOpenAI

from tools.capabilities import build_tools
from tools.newsletter_tools import create_newsletter_tool


class CapabilityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncOpenAI(api_key="dummy-for-tests")

    async def asyncTearDown(self):
        await self.client.close()

    async def test_only_connected_capabilities_registered(self):
        config = {"api_key": "dummy-for-tests"}
        self.assertEqual([tool.__name__ for tool in build_tools(config, self.client)], ["web_search"])
        self.assertEqual(build_tools({**config, "enabled_tools": []}, self.client), ())
        with self.assertRaisesRegex(ValueError, "Unimplemented"):
            build_tools({**config, "enabled_tools": ["ban_user"]}, self.client)
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(ValueError, "NEWSLETTER_API_URL"):
                build_tools({**config, "enabled_tools": ["subscribe_to_newsletter"]}, self.client)

    async def test_research_delegation_emits_lifecycle_and_enforces_budget(self):
        research, = build_tools({"api_key": "dummy", "enabled_tools": ["research"], "research_limit": 1}, self.client)
        reply = SimpleNamespace(body="A researched answer", usage=AsyncMock(return_value=SimpleNamespace(total=Usage())))
        research.agent.ask = AsyncMock(return_value=reply)
        context = ConversationContext(stream=MemoryStream())
        events = []
        async def collect(event: BaseEvent):
            events.append(event)
        with ExitStack() as stack:
            stack.enter_context(context.stream.sub_scope(collect))
            research.register(stack, context)
            await context.send(ToolCallEvent(id="first", name="research", arguments='{"objective":"Prepare a brief"}'))
            await context.send(ToolCallEvent(id="second", name="research", arguments='{"objective":"Another brief"}'))
        self.assertEqual(research.agent.ask.await_count, 1)
        self.assertTrue(any(isinstance(event, TaskStarted) for event in events))
        self.assertTrue(any(isinstance(event, TaskCompleted) for event in events))
        self.assertTrue(any(isinstance(event, ToolResultEvent) for event in events))

    async def test_newsletter_budget_is_atomic_and_scoped_to_session(self):
        requests = []

        async def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"created": True})

        def factory(**kwargs):
            return httpx.AsyncClient(transport=httpx.MockTransport(handler), **kwargs)

        signup = create_newsletter_tool("https://newsletter.example/subscribe", max_signups=2, client_factory=factory)
        self.assertIn("valid email", await signup("invalid"))
        results = await asyncio.gather(*(signup(f"person{i}@example.com") for i in range(5)))
        self.assertEqual(len(requests), 2)
        self.assertEqual(sum("confirmed" in result for result in results), 2)
        new_session = create_newsletter_tool("https://newsletter.example/subscribe", max_signups=2, client_factory=factory)
        self.assertIn("confirmed", await new_session("new@example.com"))
        self.assertEqual(len(requests), 3)

    async def test_newsletter_requires_explicit_positive_confirmation(self):
        payloads = (
            {}, {"created": False}, {"error": "signup failed"}, {"created": None},
            {"created": "true"}, {"created": 1}, {"success": True}, [],
            {"created": True, "error": "conflicting service response"},
        )
        for payload in payloads:
            with self.subTest(payload=payload):
                async def handler(request):
                    return httpx.Response(200, json=payload)

                def factory(**kwargs):
                    return httpx.AsyncClient(transport=httpx.MockTransport(handler), **kwargs)

                signup = create_newsletter_tool(
                    "https://newsletter.example/subscribe", client_factory=factory,
                )
                result = await signup("person@example.com")
                self.assertIn("did not confirm", result)
                self.assertNotIn("already subscribed", result)


if __name__ == "__main__":
    unittest.main()
