"use client";
import React, { useEffect, useState } from "react";
import logo from "../../public/icons/apple-touch-icon.png";

export default function SplashScreen() {
  const [dot, setDot] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setDot(d => (d + 1) % 3), 500);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #0f172a 100%)" }}
    >
      {/* Brand icon + horizontal logo */}
      <div className="relative mb-10 flex flex-col items-center gap-5">
        {/* Glow ring behind icon */}
        <div
          className="absolute rounded-full opacity-25"
          style={{
            width: "140px", height: "140px",
            background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)",
            animation: "splash-pulse 2s ease-in-out infinite",
          }}
        />
        {/* App icon */}
        <img
          src="/icons/icon-512.png"
          alt="ERP"
          style={{
            width: "96px", height: "96px",
            borderRadius: "24px",
            boxShadow: "0 20px 60px rgba(37,99,235,0.45)",
            animation: "splash-float 3s ease-in-out infinite",
          }}
        />
        {/* Horizontal brand logo */}
        <img
          src="/icons/horizontal-logo.png"
          alt="ERP System"
          style={{
            height: "40px",
            objectFit: "contain",
            filter: "brightness(0) invert(1)",  /* make it white on dark bg */
            animation: "splash-fadein 0.8s ease 0.15s both",
          }}
        />
      </div>

      {/* Loading dots */}
      <div className="flex items-center gap-2">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full"
            style={{
              background: dot === i ? "#3b82f6" : "rgba(255,255,255,0.2)",
              transform: dot === i ? "scale(1.4)" : "scale(1)",
              transition: "all 0.25s ease",
            }}
          />
        ))}
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-8 flex flex-col items-center gap-1">
        <div className="w-32 h-0.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-blue-400 rounded-full"
            style={{ animation: "splash-progress 1.8s ease-in-out infinite" }}
          />
        </div>
        <p className="text-white/30 text-xs mt-2">جارٍ التحقق من الجلسة...</p>
      </div>

      <style>{`
        @keyframes splash-float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-8px); }
        }
        @keyframes splash-pulse {
          0%, 100% { opacity: 0.15; transform: scale(1.6); }
          50%       { opacity: 0.35; transform: scale(2.0); }
        }
        @keyframes splash-fadein {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes splash-progress {
          0%   { width: 0%; margin-left: 0; }
          50%  { width: 70%; margin-left: 0; }
          100% { width: 0%; margin-left: 100%; }
        }
      `}</style>
    </div>
  );
}
