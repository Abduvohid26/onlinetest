"""iMentor references enrich / backfill unit tests."""
from __future__ import annotations

from django.test import SimpleTestCase

from apps.api.imentor_service import (
    enrich_questions_with_imentor_references,
    normalize_question_references,
    sync_ai_summary_item_references,
)


class EnrichImentorReferencesTests(SimpleTestCase):
    def test_enrich_attaches_by_question_text(self):
        index = {
            "60 yoshli erkak bemor appendektomiya": [
                {"title": "Oxford Textbook of Palliative Medicine", "pages": "501, 818"}
            ]
        }
        # exact key must match _normalize_question_text
        key = " ".join("60 yoshli erkak bemor appendektomiya".lower().split())
        index = {
            key: [{"title": "Oxford Textbook of Palliative Medicine", "pages": "501, 818"}]
        }
        questions = [
            {
                "id": 1,
                "text": "60 yoshli erkak bemor appendektomiya",
                "options": ["A", "B"],
                "correctAnswer": "A",
                "explanation": "Izoh",
            }
        ]
        out, n = enrich_questions_with_imentor_references(questions, index=index)
        self.assertEqual(n, 1)
        self.assertEqual(out[0]["references"][0]["title"], "Oxford Textbook of Palliative Medicine")
        self.assertEqual(out[0]["references"][0]["pages"], "501, 818")

    def test_enrich_skips_when_already_present(self):
        index = {"savol": [{"title": "Boshqa"}]}
        questions = [
            {
                "id": 1,
                "text": "savol",
                "references": [{"title": "Mavjud", "pages": "1"}],
            }
        ]
        out, n = enrich_questions_with_imentor_references(questions, index=index)
        self.assertEqual(n, 0)
        self.assertEqual(out[0]["references"][0]["title"], "Mavjud")

    def test_normalize_keeps_pages(self):
        refs = normalize_question_references(
            [{"title": "Kitob", "pages": "10-12", "url": ""}]
        )
        self.assertEqual(refs[0]["pages"], "10-12")

    def test_sync_ai_summary_fills_empty_refs(self):
        questions = [
            {"id": 7, "references": [{"title": "Kitob", "pages": "3"}]},
        ]
        ai = {
            "source": "api",
            "items": [{"questionId": 7, "references": [], "commentCorrect": "ok"}],
        }
        out = sync_ai_summary_item_references(ai, questions)
        self.assertEqual(out["items"][0]["references"][0]["title"], "Kitob")
