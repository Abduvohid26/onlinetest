"""Proctor frame local analysis tests."""
from __future__ import annotations

import unittest
from unittest import mock

from apps.api.face_embedding import analyze_proctor_frame_local


class ProctorFrameLocalTests(unittest.TestCase):
    @mock.patch("apps.api.face_embedding._get_engine", return_value=None)
    def test_unavailable(self, _eng):
        out = analyze_proctor_frame_local("abc")
        self.assertFalse(out.get("ok"))

    @mock.patch("apps.api.face_embedding._get_engine")
    def test_no_face(self, eng_mock):
        import numpy as np

        cv2 = mock.MagicMock()
        detector = mock.MagicMock()
        eng_mock.return_value = {"detector": detector, "recognizer": mock.MagicMock(), "cv2": cv2}
        detector.detect.return_value = (0, None)

        with mock.patch("apps.api.face_embedding._decode_frame_b64", return_value=b"\xff\xd8\xff"):
            with mock.patch(
                "apps.api.face_embedding._bytes_to_bgr",
                return_value=np.zeros((120, 160, 3), dtype=np.uint8),
            ):
                out = analyze_proctor_frame_local("x")

        self.assertTrue(out.get("ok"))
        self.assertIn("FACE_NOT_VISIBLE", out.get("violations") or [])
