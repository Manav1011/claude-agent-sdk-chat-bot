"""Tests for _enrich_blocks deterministic UUID behavior."""

import uuid

from chat_server import _enrich_blocks
from schemas import ContentBlock


def test_enrich_blocks_produces_stable_uuids():
    blocks = [
        ContentBlock(markdown="block one", spoken_explanation="say one"),
        ContentBlock(markdown="block two", spoken_explanation="say two"),
    ]

    first = _enrich_blocks(blocks)
    second = _enrich_blocks(blocks)

    assert first[0].uuid == second[0].uuid
    assert first[1].uuid == second[1].uuid
    assert first[0].uuid != first[1].uuid
    assert isinstance(uuid.UUID(first[0].uuid), uuid.UUID)  # valid UUID


def test_enrich_blocks_sequence_id_starts_at_one():
    blocks = [
        ContentBlock(markdown="first", spoken_explanation="a"),
        ContentBlock(markdown="second", spoken_explanation="b"),
        ContentBlock(markdown="third", spoken_explanation="c"),
    ]

    enriched = _enrich_blocks(blocks)
    assert [b.sequence_id for b in enriched] == [1, 2, 3]


def test_enrich_blocks_preserves_content():
    md = "# Hello\n\n```python\ndef foo(): pass\n```"
    spoken = "A function called foo."
    blocks = [ContentBlock(markdown=md, spoken_explanation=spoken)]

    enriched = _enrich_blocks(blocks)
    assert enriched[0].markdown == md
    assert enriched[0].spoken_explanation == spoken
