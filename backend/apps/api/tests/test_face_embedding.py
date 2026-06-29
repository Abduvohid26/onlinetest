"""Face embedding unit tests."""
from __future__ import annotations

import unittest
from unittest import mock

from apps.api import face_embedding


class FaceEmbeddingTests(unittest.TestCase):
    @mock.patch("apps.api.face_embedding._get_engine", return_value=None)
    def test_engine_unavailable(self, _eng):
        out = face_embedding.compare_face_images("abc", "def")
        self.assertFalse(out.get("success"))
        self.assertEqual(out.get("code"), "FACE_ENGINE_UNAVAILABLE")

    @mock.patch("apps.api.face_embedding._get_engine")
    def test_match_above_threshold(self, eng_mock):
        import numpy as np

        cv2 = mock.MagicMock()
        cv2.FaceRecognizerSF_FR_COSINE = 1
        detector = mock.MagicMock()
        recognizer = mock.MagicMock()
        recognizer.match.return_value = 0.82
        eng_mock.return_value = {"detector": detector, "recognizer": recognizer, "cv2": cv2}

        face = np.array([10, 10, 80, 80], dtype=np.float32)
        detector.detect.return_value = (1, np.array([face]))

        with mock.patch("apps.api.face_embedding._decode_b64_image", return_value=b"\xff\xd8\xff"):
            with mock.patch("apps.api.face_embedding._bytes_to_bgr", return_value=np.zeros((120, 120, 3), dtype=np.uint8)):
                out = face_embedding.compare_face_images("p", "l")

        self.assertTrue(out.get("success"))
        self.assertTrue(out.get("match"))
        self.assertEqual(out.get("method"), "embedding")
        self.assertGreaterEqual(out.get("score", 0), 0.8)

    @mock.patch("apps.api.face_embedding._get_engine")
    def test_no_face_detected(self, eng_mock):
        import numpy as np

        cv2 = mock.MagicMock()
        detector = mock.MagicMock()
        recognizer = mock.MagicMock()
        eng_mock.return_value = {"detector": detector, "recognizer": recognizer, "cv2": cv2}
        detector.detect.return_value = (0, None)

        with mock.patch("apps.api.face_embedding._decode_b64_image", return_value=b"\xff\xd8\xff"):
            with mock.patch("apps.api.face_embedding._bytes_to_bgr", return_value=np.zeros((120, 120, 3), dtype=np.uint8)):
                out = face_embedding.compare_face_images("p", "l")

        self.assertTrue(out.get("success"))
        self.assertFalse(out.get("match"))
        self.assertEqual(out.get("code"), "FACE_NOT_DETECTED")
