import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button } from './ui';
import { motion, AnimatePresence } from 'motion/react';
import { createRealtimeSocket, buildRealtimeUrl } from '../lib/realtimeSocket';
import { apiUrl } from '../lib/apiUrl';

interface LiveMonitorProps {
  examId: number;
  token: string;
  onClose: () => void;
}

interface BanAlert {
  student_id: string;
  student_name: string;
  student_exam_id: number;
  reason: string;
  violations_count: number;
  resolved?: boolean;
}

export function LiveMonitor({ examId, token, onClose }: LiveMonitorProps) {
  const [students, setStudents] = useState<{ id: string; channel: string }[]>([]);
  const [banAlerts, setBanAlerts] = useState<BanAlert[]>([]);
  const [unblockBusy, setUnblockBusy] = useState<Record<number, boolean>>({});
  const wsRef = useRef<ReturnType<typeof createRealtimeSocket> | null>(null);
  const myChannelRef = useRef<string | null>(null);
  const peerConnectionsRef = useRef<{ [channel: string]: RTCPeerConnection }>({});
  const videoRefs = useRef<{ [channel: string]: HTMLVideoElement | null }>({});

  const handleUnblock = async (seId: number, canRetake: boolean) => {
    setUnblockBusy((prev) => ({ ...prev, [seId]: true }));
    try {
      await fetch(apiUrl(`/api/admin/student_exams/${seId}/unblock`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ can_retake: canRetake }),
      });
      setBanAlerts((prev) =>
        prev.map((a) => (a.student_exam_id === seId ? { ...a, resolved: true } : a)),
      );
    } catch {
      /* ignore */
    } finally {
      setUnblockBusy((prev) => ({ ...prev, [seId]: false }));
    }
  };

  useEffect(() => {
    const wsUrl = buildRealtimeUrl(token);
    const wsInstance = createRealtimeSocket(wsUrl, async (msg) => {
      if (msg.type === 'connected') {
        myChannelRef.current = msg.channel as string;
        wsInstance.send({ type: 'join_exam', exam_id: examId, role: 'proctor' });
      } else if (msg.type === 'student_banned') {
        const md = msg as any;
        setBanAlerts((prev) => {
          const exists = prev.find((a) => a.student_exam_id === md.student_exam_id);
          if (exists) return prev;
          return [
            ...prev,
            {
              student_id: md.student_id,
              student_name: md.student_name || md.student_id,
              student_exam_id: md.student_exam_id,
              reason: md.reason,
              violations_count: md.violations_count,
            },
          ];
        });
      } else if (msg.type === 'student_joined') {
        const channel = msg.channel as string;
        const userId = msg.user_id as string;

        setStudents((prev) => {
          if (!prev.find((s) => s.channel === channel)) {
            return [...prev, { id: userId, channel }];
          }
          return prev;
        });

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        peerConnectionsRef.current[channel] = pc;

        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            wsInstance.send({
              type: 'ice_candidate',
              to: channel,
              candidate: ev.candidate.toJSON(),
            });
          }
        };

        pc.ontrack = (ev) => {
          const video = videoRefs.current[channel];
          if (video) video.srcObject = ev.streams[0];
        };

        const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        wsInstance.send({
          type: 'offer',
          to: channel,
          offer,
          from_id: myChannelRef.current ?? '',
        });
      } else if (msg.type === 'answer') {
        const fromChannel = msg.from as string;
        const pc = peerConnectionsRef.current[fromChannel];
        if (pc) {
          await pc.setRemoteDescription(
            new RTCSessionDescription(msg.answer as RTCSessionDescriptionInit),
          );
        }
      } else if (msg.type === 'ice_candidate') {
        const fromChannel = msg.from as string;
        const pc = peerConnectionsRef.current[fromChannel];
        if (pc) {
          await pc.addIceCandidate(
            new RTCIceCandidate(msg.candidate as RTCIceCandidateInit),
          );
        }
      }
    });
    wsRef.current = wsInstance;

    return () => {
      wsRef.current?.destroy();
      Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
    };
  }, [examId, token]);

  const activeAlerts = banAlerts.filter((a) => !a.resolved);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col p-6 overflow-y-auto"
    >
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Live Monitoring (Exam {examId})</h2>
        <Button variant="destructive" onClick={onClose}>Close Monitor</Button>
      </div>

      {/* Ban alerts */}
      <AnimatePresence>
        {activeAlerts.map((alert) => (
          <motion.div
            key={alert.student_exam_id}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="mb-4 rounded-xl border-2 border-red-500 bg-red-950/90 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0" />
                <span className="text-red-300 font-bold text-sm">TALABA BLOKLANDI</span>
              </div>
              <p className="text-white font-semibold truncate">
                {alert.student_name} <span className="text-gray-400 font-normal text-xs">(ID: {alert.student_id})</span>
              </p>
              <p className="text-red-300 text-xs mt-0.5 truncate">Sabab: {alert.reason}</p>
              <p className="text-gray-400 text-xs">Jami qoidabuzarliklar: {alert.violations_count}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                disabled={unblockBusy[alert.student_exam_id]}
                onClick={() => handleUnblock(alert.student_exam_id, true)}
                className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                {unblockBusy[alert.student_exam_id] ? '...' : '✓ Davom etishga ruxsat'}
              </button>
              <button
                type="button"
                disabled={unblockBusy[alert.student_exam_id]}
                onClick={() => handleUnblock(alert.student_exam_id, false)}
                className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                {unblockBusy[alert.student_exam_id] ? '...' : '✕ Blokda qoldirish'}
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {students.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/50">
          No students currently connected to this exam.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {students.map((student) => {
            const isBanned = banAlerts.some(
              (a) => a.student_id === student.id && !a.resolved,
            );
            return (
              <Card
                key={student.channel}
                className={`overflow-hidden transition-all ${
                  isBanned ? 'border-2 border-red-500 bg-red-950/30' : 'bg-gray-900 border-gray-800'
                }`}
              >
                <CardHeader className="p-3 bg-gray-800/50">
                  <CardTitle className="text-sm text-gray-200 flex items-center gap-2">
                    {isBanned && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                    Student: {student.id}
                    {isBanned && <span className="text-red-400 text-xs font-normal ml-auto">BLOKLANDI</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 aspect-video bg-black relative">
                  <video
                    ref={(el) => { videoRefs.current[student.channel] = el; }}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {isBanned && (
                    <div className="absolute inset-0 bg-red-900/40 flex items-center justify-center">
                      <span className="text-red-300 text-xs font-bold bg-black/60 px-2 py-1 rounded">BLOKLANDI</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
