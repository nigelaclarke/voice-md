"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import type { EditorHandle } from "@/components/editor";
import { Voice } from "@/components/voice";

const Editor = dynamic(() => import("@/components/editor"), { ssr: false });

export default function Home() {
  const editorRef = useRef<EditorHandle>(null);

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Editor ref={editorRef} />
      </main>
      <Voice editorRef={editorRef} />
    </div>
  );
}
