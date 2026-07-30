"""API (iMentor) izohlari imtihon quvuri bo'ylab yo'qolmasligi.

Natija sahifasidagi tushuntirish AI tomonidan qayta yozilmasligi kerak — iMentor
API savol bilan birga `explanation` va `optionExplanations` (manba ko'rsatilgan)
yuboradi. Ilgari ikki joyda bu maydonlar tushib qolardi va natijada
`explanationSource` "api" emas, "ai" bo'lib chiqardi.
"""
from __future__ import annotations

from unittest import mock

from django.test import TestCase

from apps.api.gemini_tools import paraphrase_medical_mcqs
from apps.api.imentor_service import (
    _transform_imentor_questions,
    normalize_question_references,
)
from apps.api.services import (
    build_exam_ai_summary,
    build_fallback_ai_summary,
    exam_question_with_translations,
    exam_questions_add_translations,
    localize_exam_question,
    question_has_api_explanations,
    question_references,
)


REFERENCES = [
    {
        "url": "https://pubmed.ncbi.nlm.nih.gov/29420409/",
        "year": "2018",
        "title": "Nausea and Vomiting of Pregnancy",
        "authors": "ACOG Practice Bulletin",
        "publisher": "American College of Obstetricians and Gynecologists",
    },
]


def _imentor_question() -> dict:
    return {
        "references": [dict(r) for r in REFERENCES],
        "id": 1,
        "text": "Homiladorlikda qusishda qaysi dori minimal xavf tug'diradi?",
        "options": ["Dimenhidrinat", "Meclizine", "Pyridoxine (B6)", "Prometazin"],
        "correctAnswer": "Pyridoxine (B6)",
        "explanation": "Pyridoxine (B6) keng qo'llaniladi (Manba: kitob, 120-bet).",
        "optionExplanations": [
            "Dimenhidrinat birinchi tanlov emas.",
            "Meclizine ehtiyotkorlik bilan.",
            "Pyridoxine (B6) minimal xavf (Manba: kitob, 120-bet).",
            "Prometazin xavflar bilan bog'liq.",
        ],
    }


class ParaphraseKeepsApiExplanationsTests(TestCase):
    """Paraphrase savol matnini o'zgartiradi — izoh manbasi qolishi shart."""

    def _run_paraphrase(self, model_rows: list[dict]) -> list[dict]:
        with (
            mock.patch("apps.api.gemini_tools.api_key_configured", return_value=True),
            mock.patch("apps.api.gemini_tools._client", return_value=object()),
            mock.patch("apps.api.gemini_tools._generate", return_value="[]"),
            mock.patch(
                "apps.api.gemini_tools._extract_json_array_from_model_text",
                return_value=model_rows,
            ),
        ):
            return paraphrase_medical_mcqs([_imentor_question()], "uz")

    def test_paraphrase_preserves_explanation_and_option_explanations(self):
        out = self._run_paraphrase(
            [
                {
                    "t": "Qayta yozilgan savol matni",
                    "o": ["Dimenhidrinat", "Meclizine", "Vitamin B6", "Prometazin"],
                    "ca": "Vitamin B6",
                }
            ]
        )
        q = out[0]
        self.assertEqual(q["text"], "Qayta yozilgan savol matni")
        self.assertEqual(q["correctAnswer"], "Vitamin B6")
        self.assertEqual(q["id"], 1)
        self.assertTrue(question_has_api_explanations(q))
        self.assertIn("Manba: kitob, 120-bet", q["explanation"])
        # Variantlar pozitsion qayta yozilgan — izohlar ham o'sha tartibda.
        self.assertEqual(len(q["optionExplanations"]), 4)
        self.assertIn("minimal xavf", q["optionExplanations"][2])

    def test_paraphrase_drops_option_explanations_when_option_count_changes(self):
        """Variantlar soni o'zgarsa moslikni kafolatlab bo'lmaydi — noto'g'ri
        izoh ko'rsatgandan ko'ra tashlab yuborilsin (umumiy izoh qoladi)."""
        out = self._run_paraphrase(
            [{"t": "Qisqargan", "o": ["A varianti", "B varianti"], "ca": "A varianti"}]
        )
        q = out[0]
        self.assertNotIn("optionExplanations", q)
        self.assertIn("Manba: kitob, 120-bet", q["explanation"])


class TranslationKeepsApiExplanationsTests(TestCase):
    def test_exam_question_with_translations_keeps_explanations(self):
        out = exam_question_with_translations(
            _imentor_question(),
            {
                "text_ru": "Русский текст",
                "text_en": "English text",
                "options_ru": ["Д", "М", "П", "Пр"],
                "options_en": ["D", "M", "P", "Pr"],
                "correct_answer_ru": "П",
                "correct_answer_en": "P",
            },
            "uz",
        )
        self.assertTrue(question_has_api_explanations(out))
        self.assertEqual(out["explanation_uz"], out["explanation"])
        self.assertEqual(len(out["optionExplanations_uz"]), 4)

    def test_add_translations_keeps_explanations_even_when_ai_fails(self):
        with mock.patch(
            "apps.api.gemini_tools.translate_questions_batch",
            side_effect=RuntimeError("no key"),
        ):
            out = exam_questions_add_translations([_imentor_question()], "uz")
        self.assertTrue(question_has_api_explanations(out[0]))

    def test_localize_keeps_explanation_for_other_language(self):
        q = exam_question_with_translations(
            _imentor_question(),
            {
                "text_ru": "Русский текст",
                "text_en": "English text",
                "options_ru": ["Д", "М", "П", "Пр"],
                "options_en": ["D", "M", "P", "Pr"],
                "correct_answer_ru": "П",
                "correct_answer_en": "P",
            },
            "uz",
        )
        ru = localize_exam_question(q, "ru")
        # Ruscha izoh yo'q — manba tilidagi izoh ko'rsatiladi (AI o'ylab topgani emas).
        self.assertTrue(question_has_api_explanations(ru))
        self.assertEqual(len(ru["optionExplanations"]), len(ru["options"]))


class AiSummaryPrefersApiTests(TestCase):
    def test_summary_source_is_api_and_ai_is_not_called(self):
        questions = [_imentor_question()]
        answers = {"1": "Dimenhidrinat"}
        with mock.patch("apps.api.gemini_tools.generate_exam_ai_summary") as gen:
            summary = build_exam_ai_summary(questions, answers, "uz")
        gen.assert_not_called()
        self.assertEqual(summary["source"], "api")
        item = summary["items"][0]
        self.assertEqual(item["explanationSource"], "api")
        self.assertIn("birinchi tanlov emas", item["whyStudentWrong"])
        self.assertIn("Manba: kitob, 120-bet", item["whyCorrectIsRight"])

    def test_ai_receives_only_questions_without_api_explanations(self):
        with_api = _imentor_question()
        without_api = {
            "id": 2,
            "text": "Izohsiz savol",
            "options": ["A", "B"],
            "correctAnswer": "A",
        }
        answers = {"1": "Dimenhidrinat", "2": "B"}
        captured: dict = {}

        def _fake_summary(qs, ans, lang):
            captured["ids"] = [q["id"] for q in qs]
            return {
                "overview": "AI",
                "source": "ai",
                "items": [
                    {
                        "questionId": 2,
                        "isCorrect": False,
                        "whyStudentWrong": "AI izohi",
                        "whyCorrectIsRight": "AI to'g'ri izohi",
                    }
                ],
            }

        with mock.patch(
            "apps.api.gemini_tools.generate_exam_ai_summary", side_effect=_fake_summary
        ):
            summary = build_exam_ai_summary([with_api, without_api], answers, "uz")

        self.assertEqual(captured["ids"], [2], "API izohi bor savol AI ga yuborilmasin")
        self.assertEqual(summary["source"], "mixed")
        by_id = {i["questionId"]: i for i in summary["items"]}
        self.assertEqual(by_id[1]["explanationSource"], "api")
        self.assertIn("Manba: kitob, 120-bet", by_id[1]["whyCorrectIsRight"])
        self.assertEqual(by_id[2]["explanationSource"], "ai")
        self.assertEqual(by_id[2]["whyStudentWrong"], "AI izohi")

    def test_fallback_summary_marks_api_source(self):
        summary = build_fallback_ai_summary([_imentor_question()], {"1": "Pyridoxine (B6)"})
        self.assertEqual(summary["source"], "api")
        self.assertIn("Manba: kitob, 120-bet", summary["items"][0]["commentCorrect"])


class QuestionReferencesTests(TestCase):
    """Manba (kitob/maqola) natija sahifasigacha yetib borishi.

    iMentor izohda manbalarga [1][2] bilan ishora qiladi, ro'yxatning o'zi esa
    alohida `references` maydonida keladi. Bu maydon ilgari umuman o'qilmasdi —
    shu sababli natijada manba ko'rinmasdi.
    """

    def test_transform_reads_references_from_api(self):
        out = _transform_imentor_questions(
            [
                {
                    "question": "Savol",
                    "options": ["A", "B"],
                    "correctOptionIndex": 0,
                    "explanation": "Izoh [1].",
                    "references": REFERENCES,
                }
            ]
        )
        refs = out[0]["references"]
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0]["title"], "Nausea and Vomiting of Pregnancy")
        self.assertEqual(refs[0]["year"], "2018")

    def test_keeps_book_pages(self):
        """`pages` — talaba uchun eng qimmatli maydon (qaysi betga qarash)."""
        refs = normalize_question_references(
            [{"title": "Williams obstetrics", "pages": "643"}]
        )
        self.assertEqual(refs, [{"title": "Williams obstetrics", "pages": "643"}])

        refs = normalize_question_references(
            [{"title": "Guyton", "pages": "114-118, 220", "year": "2020"}]
        )
        self.assertEqual(refs[0]["pages"], "114-118, 220")
        self.assertEqual(refs[0]["year"], "2020")

    def test_normalize_drops_unsafe_url_but_keeps_title(self):
        refs = normalize_question_references(
            [{"title": "Kitob", "url": "javascript:alert(1)"}]
        )
        self.assertEqual(refs, [{"title": "Kitob"}])

    def test_normalize_skips_empty_and_duplicates(self):
        refs = normalize_question_references(
            [
                {"title": "Bir xil", "url": "https://a.example/1"},
                {"title": "Bir xil", "url": "https://a.example/1"},
                {"publisher": "faqat nashriyot"},
                "matn",
            ]
        )
        self.assertEqual(len(refs), 1)

    def test_references_survive_paraphrase(self):
        with (
            mock.patch("apps.api.gemini_tools.api_key_configured", return_value=True),
            mock.patch("apps.api.gemini_tools._client", return_value=object()),
            mock.patch("apps.api.gemini_tools._generate", return_value="[]"),
            mock.patch(
                "apps.api.gemini_tools._extract_json_array_from_model_text",
                return_value=[
                    {
                        "t": "Qayta yozilgan",
                        "o": ["Dimenhidrinat", "Meclizine", "Vitamin B6", "Prometazin"],
                        "ca": "Vitamin B6",
                    }
                ],
            ),
        ):
            out = paraphrase_medical_mcqs([_imentor_question()], "uz")
        self.assertEqual(question_references(out[0]), REFERENCES)

    def test_references_survive_translation_and_localization(self):
        q = exam_question_with_translations(
            _imentor_question(),
            {
                "text_ru": "Русский",
                "text_en": "English",
                "options_ru": ["Д", "М", "П", "Пр"],
                "options_en": ["D", "M", "P", "Pr"],
                "correct_answer_ru": "П",
                "correct_answer_en": "P",
            },
            "uz",
        )
        self.assertEqual(question_references(q), REFERENCES)
        # Manbalar tilga bog'liq emas — har uch tilda bir xil ro'yxat.
        for lang in ("uz", "ru", "en"):
            self.assertEqual(question_references(localize_exam_question(q, lang)), REFERENCES)

    def test_summary_item_carries_references(self):
        summary = build_exam_ai_summary([_imentor_question()], {"1": "Dimenhidrinat"}, "uz")
        item = summary["items"][0]
        self.assertEqual(item["explanationSource"], "api")
        self.assertEqual(item["references"], REFERENCES)

    def test_ai_sourced_item_has_no_references(self):
        no_api = {"id": 2, "text": "Izohsiz", "options": ["A", "B"], "correctAnswer": "A"}
        summary = build_fallback_ai_summary([no_api], {"2": "B"})
        self.assertEqual(summary["items"][0]["references"], [])
