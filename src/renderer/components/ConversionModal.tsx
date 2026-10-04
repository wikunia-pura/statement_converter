import React, { useState } from 'react';
import { FileEntry } from '../../shared/types';
import { translations, Language } from '../translations';
import Converter from '../views/Converter';
import ModalDismiss, { ModalHeader } from './Modal';

/**
 * The Converter, over the dashboard: the statements the folder scan pinned —
 * one file, one community's, or several communities' at once — open here
 * already recognised, and are converted without leaving the Pulpit. The
 * review screen opens full-screen above it, as in the Converter, and closing
 * it comes back to this list.
 *
 * The list is its own, not the Converter tab's: what was being converted
 * there stays where it was.
 */
const ConversionModal: React.FC<{
  language: Language;
  title: string;
  entries: FileEntry[];
  /** `converted` — at least one file finished; the dashboard reloads. */
  onClose: (converted: boolean) => void;
}> = ({ language, title, entries, onClose }) => {
  const t = translations[language];
  const [files, setFiles] = useState<FileEntry[]>(entries);
  const [selectedBank, setSelectedBank] = useState<number | null>(
    entries.find((e) => e.bankId != null)?.bankId ?? null,
  );
  const busy = files.some((f) => f.status === 'processing');
  const done = files.filter((f) => f.status === 'success').length;

  const close = () => {
    if (busy) return; // a conversion in flight would lose its result
    onClose(files.some((f) => f.status === 'success' || f.status === 'error'));
  };

  return (
    // No close on a click beside it: the list is the work in progress, and a
    // stray click must not throw it away. The X and Escape close it.
    <div className="modal-overlay">
      <div className="modal conv-modal">
        {!busy && <ModalDismiss onClose={close} ariaLabel={t.close} />}
        <ModalHeader
          icon="zap"
          title={title}
          subtitle={t.ksConvModalProgress.replace('{done}', String(done)).replace('{total}', String(files.length))}
        />
        <div className="conv-modal__body">
          <Converter
            language={language}
            files={files}
            setFiles={setFiles}
            selectedBank={selectedBank}
            setSelectedBank={setSelectedBank}
            embedded
          />
        </div>
      </div>
    </div>
  );
};

export default ConversionModal;
