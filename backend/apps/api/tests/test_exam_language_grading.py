from types import SimpleNamespace

from apps.api.services import prepare_questions_for_grading


def _multilingual_q():
    return {
        "id": 1,
        "text": "Original",
        "text_uz": "Savol uz",
        "text_ru": "Вопрос ru",
        "text_en": "Question en",
        "options": ["A", "B"],
        "options_uz": ["A uz", "B uz"],
        "options_ru": ["A ru", "B ru"],
        "options_en": ["A en", "B en"],
        "correctAnswer": "A",
        "correct_answer_uz": "A uz",
        "correct_answer_ru": "A ru",
        "correct_answer_en": "A en",
    }


def test_prepare_questions_for_grading_fixed_language():
    exam = SimpleNamespace(language="ru")
    out = prepare_questions_for_grading([_multilingual_q()], exam, student_lang="uz")
    assert out[0]["text"] == "Original"


def test_prepare_questions_for_grading_auto_with_hint():
    exam = SimpleNamespace(language="auto")
    out = prepare_questions_for_grading([_multilingual_q()], exam, student_lang="ru")
    assert out[0]["text"] == "Вопрос ru"
    assert out[0]["correctAnswer"] == "A ru"


def test_prepare_questions_for_grading_auto_detect_from_answers():
    exam = SimpleNamespace(language="auto")
    answers = {"1": "A en"}
    out = prepare_questions_for_grading([_multilingual_q()], exam, answers)
    assert out[0]["correctAnswer"] == "A en"
