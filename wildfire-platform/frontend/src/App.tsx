import React from 'react';
import Sidebar from '@/components/Sidebar/Sidebar';
import FireMap from '@/components/Map/FireMap';

function App() {
  return (
    <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
      <Sidebar />
      <div className="flex-1 relative">
        <FireMap />
      </div>
      {/* Toast/Notification area could go here */}
      <div id="toast-root" className="absolute top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"></div>
    </div>
  );
}

export default App;
