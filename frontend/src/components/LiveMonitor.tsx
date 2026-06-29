import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button } from './ui';
import { motion } from 'motion/react';
import { createRealtimeSocket, buildRealtimeUrl } from '../lib/realtimeSocket';

interface LiveMonitorProps {
  examId: number;
  token: string;
  onClose: () => void;
}

export function LiveMonitor({ examId, token, onClose }: LiveMonitorProps) {
  const [students, setStudents] = useState<{ id: string; channel: string }[]>([]);
  const wsRef = useRef<ReturnType<typeof createRealtimeSocket> | null>(null);
  const myChannelRef = useRef<string | null>(null);
  const peerConnectionsRef = useRef<{ [channel: string]: RTCPeerConnection }>({});
  const videoRefs = useRef<{ [channel: string]: HTMLVideoElement | null }>({});

  useEffect(() => {
    const wsUrl = buildRealtimeUrl(token);
    const wsInstance = createRealtimeSocket(wsUrl, async (msg) => {
      if (msg.type === 'connected') {
        myChannelRef.current = msg.channel as string;
        wsInstance.send({ type: 'join_exam', exam_id: examId, role: 'proctor' });
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col p-6"
    >
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Live Monitoring (Exam {examId})</h2>
        <Button variant="destructive" onClick={onClose}>Close Monitor</Button>
      </div>

      {students.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/50">
          No students currently connected to this exam.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto">
          {students.map((student) => (
            <Card key={student.channel} className="bg-gray-900 border-gray-800 overflow-hidden">
              <CardHeader className="p-3 bg-gray-800/50">
                <CardTitle className="text-sm text-gray-200">Student ID: {student.id}</CardTitle>
              </CardHeader>
              <CardContent className="p-0 aspect-video bg-black relative">
                <video
                  ref={(el) => { videoRefs.current[student.channel] = el; }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </motion.div>
  );
}
