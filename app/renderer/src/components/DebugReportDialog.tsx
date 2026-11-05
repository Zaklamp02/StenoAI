import { t } from '@/i18n';
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Muted } from '@/components/ui/typography';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

/**
 * Shows one note's debug report in full and sends it on request. The user
 * reads exactly what goes out: main rebuilds the same report from the same
 * files when sending (see app/debug-report-ipc.js), so there is no second,
 * unseen version.
 */
export function DebugReportDialog({
  meetingStem,
  open,
  onOpenChange,
}: {
  meetingStem: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const preview = useQuery({
    queryKey: ['debug-report', meetingStem],
    queryFn: async () => unwrap(await ipc().meetings.getDebugReport(meetingStem as string)).report,
    enabled: open && Boolean(meetingStem),
    // Rebuilt on every open, so the preview is never older than what is sent.
    gcTime: 0,
    staleTime: 0,
  });
  const sender = useMutation({
    mutationFn: async () => unwrap(await ipc().meetings.sendDebugReport(meetingStem as string)).report_id,
  });

  const changeOpen = (next: boolean) => {
    if (!next) {
      sender.reset();
      setCopied(false);
    }
    onOpenChange(next);
  };

  const report = preview.data;
  const reportId = sender.data;
  const errorMessage = preview.isError
    ? t('debugReport.buildFailed')
    : sender.isError
      ? t('debugReport.sendFailed')
      : null;
  const sendable = Boolean(report) && !sender.isPending && !reportId;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-xl" data-debug-report>
        <DialogHeader>
          <DialogTitle>
            {reportId ? t('debugReport.sentTitle') : t('debugReport.title')}
          </DialogTitle>
          {!reportId && (
            <DialogDescription>{t('debugReport.description')}</DialogDescription>
          )}
        </DialogHeader>

        {preview.isPending && <Muted>{t('debugReport.loading')}</Muted>}
        {errorMessage && (
          <p className="text-sm" style={{ color: 'var(--danger)' }} role="alert">
            {errorMessage}
          </p>
        )}
        {report && !reportId && (
          <pre
            className="max-h-[45vh] overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground"
            data-debug-report-preview
          >
            {JSON.stringify(report, null, 2)}
          </pre>
        )}
        {reportId && (
          <div className="space-y-2">
            <Muted>{t('debugReport.sentBody', { id: reportId })}</Muted>
            <code className="block rounded-md border border-border bg-muted/40 p-2 font-mono text-[12px]" data-debug-report-id>
              {reportId}
            </code>
          </div>
        )}

        <DialogFooter>
          {reportId ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(reportId).then(() => setCopied(true));
                }}
              >
                {copied ? t('debugReport.copied') : t('debugReport.copyId')}
              </Button>
              <Button onClick={() => changeOpen(false)}>{t('debugReport.close')}</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => changeOpen(false)}>
                {t('debugReport.cancel')}
              </Button>
              <Button
                onClick={() => sender.mutate()}
                disabled={!sendable}
                data-debug-report-send
              >
                {sender.isPending ? t('debugReport.sending') : t('debugReport.send')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
