"""
Javoblarni tekshirish — bitta nomuvofiq javob imtihonni yakunlashni BLOKLAMASLIGI kerak.

Fon: talaba "Yakunlash" bosganda "Invalid answer for question 1" xatosi chiqib,
imtihonni umuman topshira olmay qolgan edi. Submit qat'iy rejimda ishlab, mos
kelmagan bitta javobga HTTP 400 qaytarardi — ya'ni bitta savolning texnik
nomuvofiqligi butun imtihonni qulflardi.
"""
from django.test import SimpleTestCase

from apps.api.view_utils import match_exam_option, validate_exam_answers

QUESTIONS = [
    {"id": 1, "options": ["Metoklopramid", "Prometazin", "Ondansetron"], "correctAnswer": "Prometazin"},
    {"id": 2, "options": ["Ha", "Yo'q"], "correctAnswer": "Ha"},
]


class MatchExamOptionTests(SimpleTestCase):
    def test_exact_match(self):
        self.assertEqual(match_exam_option("Prometazin", ["Metoklopramid", "Prometazin"]), "Prometazin")

    def test_whitespace_difference_is_forgiven(self):
        # Frontend variantlarni ko'rsatishdan oldin .trim() qiladi; import qilingan
        # savollarda esa chetda bo'shliq/yangi qator qolishi mumkin.
        self.assertEqual(match_exam_option("Prometazin", ["  Prometazin\n"]), "  Prometazin\n")

    def test_case_difference_is_forgiven(self):
        self.assertEqual(match_exam_option("prometazin", ["Prometazin"]), "Prometazin")

    def test_returns_canonical_option_not_student_input(self):
        # Baholash correctAnswer bilan AYNAN solishtiradi — shu sabab kanonik
        # (savoldagi) ko'rinish qaytishi shart.
        self.assertEqual(match_exam_option(" ha ", ["Ha", "Yo'q"]), "Ha")

    def test_unrelated_answer_does_not_match(self):
        self.assertIsNone(match_exam_option("Aspirin", ["Metoklopramid", "Prometazin"]))


class ValidateExamAnswersTests(SimpleTestCase):
    def test_strict_mode_still_raises(self):
        # Til aniqlash shu xatoga tayanadi — qaysi til variantlari javoblarga
        # mos kelishini shu orqali tanlaydi.
        with self.assertRaises(ValueError):
            validate_exam_answers(QUESTIONS, {"1": "Aspirin"}, strict=True)

    def test_tolerant_mode_drops_bad_answer_but_keeps_the_rest(self):
        norm = validate_exam_answers(QUESTIONS, {"1": "Aspirin", "2": "Ha"}, strict=False)
        self.assertNotIn("1", norm, "nomuvofiq javob tashlab yuborilishi kerak")
        self.assertEqual(norm["2"], "Ha", "qolgan javoblar saqlanishi kerak")

    def test_tolerant_mode_normalizes_whitespace_answer(self):
        qs = [{"id": 1, "options": [" Prometazin ", "Ondansetron"]}]
        norm = validate_exam_answers(qs, {"1": "Prometazin"}, strict=False)
        self.assertEqual(norm["1"], " Prometazin ", "kanonik variant qaytishi kerak")

    def test_empty_answer_is_kept_as_unanswered(self):
        norm = validate_exam_answers(QUESTIONS, {"1": ""}, strict=False)
        self.assertEqual(norm["1"], "")

    def test_unknown_question_id_is_ignored(self):
        norm = validate_exam_answers(QUESTIONS, {"999": "Ha"}, strict=False)
        self.assertEqual(norm, {})

    def test_grading_still_works_after_normalization(self):
        # Bo'shliqli variantda ham to'g'ri javob to'g'ri sanalishi kerak.
        qs = [{"id": 1, "options": ["  Ha  ", "Yo'q"], "correctAnswer": "  Ha  "}]
        norm = validate_exam_answers(qs, {"1": "Ha"}, strict=False)
        score = sum(1 for q in qs if norm.get(str(q["id"])) == q.get("correctAnswer"))
        self.assertEqual(score, 1)
