'use client';

import React, { useEffect, useState } from 'react';
import { captureNextGlobalError } from '@tracex/nextjs/client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    captureNextGlobalError(error).then((id) => setEventId(id));
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen p-4 font-sans">
        <div className="max-w-md w-full p-8 bg-slate-900 border border-red-500/30 rounded-2xl shadow-2xl text-center">
          <div className="w-14 h-14 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            !
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Critical Global Application Error</h2>
          <p className="text-sm text-slate-400 mb-4">{error?.message || 'A catastrophic unhandled error occurred.'}</p>
          {eventId && (
            <p className="text-xs font-mono bg-slate-950 p-2.5 rounded-lg text-slate-400 mb-6 border border-slate-800">
              Reference ID: <span className="text-indigo-400 font-bold">{eventId}</span>
            </p>
          )}
          <button
            onClick={() => reset()}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
