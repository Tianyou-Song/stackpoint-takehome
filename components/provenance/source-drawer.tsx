"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { FileText, X } from "lucide-react";
import type { SourceReference } from "@/lib/types";

interface SourceDrawerProps {
  source: SourceReference;
  trigger: React.ReactNode;
}

export function SourceDrawer({ source, trigger }: SourceDrawerProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl z-50 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              <Dialog.Title className="font-semibold text-gray-900 text-sm">Source Document</Dialog.Title>
            </div>
            <Dialog.Close className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Document</p>
              <p className="text-sm text-gray-900">{source.documentName}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Page</p>
              <p className="text-sm text-gray-900">Page {source.pageNumber}</p>
            </div>
            {source.exactQuote && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Exact Quote</p>
                <blockquote className="border-l-4 border-blue-300 pl-4 text-sm text-gray-700 italic bg-blue-50 py-3 pr-3 rounded-r">
                  {source.exactQuote}
                </blockquote>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
