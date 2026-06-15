import React from "react";

export const GenericPage: React.FC<{ title: string }> = ({ title }) => {
  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-6">{title}</h1>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <p className="text-slate-500 italic">Halaman {title} sedang dalam pengembangan.</p>
      </div>
    </div>
  );
};
