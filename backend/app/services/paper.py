"""Builds each student's own paper: question order and option order."""

import random
from typing import Any

_random = random.SystemRandom()


def shuffled(items: list[Any]) -> list[Any]:
    copy = list(items)
    _random.shuffle(copy)
    return copy


def build_paper(questions: list[dict[str, Any]], *, shuffle_questions: bool, shuffle_options: bool) -> tuple[list[int], dict[str, list[int]]]:
    """`questions` must be sorted by section, then position.

    Sections keep their order. Within a section, questions that share a reading passage stay together
    (in their original order) and move as one block.
    Returns (question ids in paper order, {question id: option indexes in display order}).
    """
    sections: dict[int, list[dict[str, Any]]] = {}
    for q in questions:
        sections.setdefault(q["section_id"], []).append(q)

    order: list[int] = []
    for items in sections.values():
        blocks: list[list[dict[str, Any]]] = []
        by_passage: dict[int, list[dict[str, Any]]] = {}
        for q in items:
            if q["passage_id"]:
                if q["passage_id"] not in by_passage:
                    by_passage[q["passage_id"]] = []
                    blocks.append(by_passage[q["passage_id"]])
                by_passage[q["passage_id"]].append(q)
            else:
                blocks.append([q])
        for block in shuffled(blocks) if shuffle_questions else blocks:
            order.extend(q["id"] for q in block)

    option_orders: dict[str, list[int]] = {}
    for q in questions:
        idx = list(range(len(q["options"])))
        option_orders[str(q["id"])] = shuffled(idx) if shuffle_options else idx
    return order, option_orders
