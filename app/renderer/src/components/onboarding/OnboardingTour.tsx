import { t } from '@/i18n';
import * as React from 'react';
import { CalendarDays, Mic, Sparkles, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Display, Lead, Muted } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

interface TourSlide {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  /** Optional shortcut into the app, which also ends the tour. */
  action?: { label: string; route: string };
}

function tourSlides(): TourSlide[] {
  return [
    {
      id: 'record',
      icon: Mic,
      title: t('onboardingTour.recordTitle'),
      body: t('onboardingTour.recordBody'),
    },
    {
      id: 'calendar',
      icon: CalendarDays,
      title: t('onboardingTour.calendarTitle'),
      body: t('onboardingTour.calendarBody'),
      action: { label: t('onboardingTour.openIntegrations'), route: '/settings?tab=integrations' },
    },
    {
      id: 'ask',
      icon: Sparkles,
      title: t('onboardingTour.askTitle'),
      body: t('onboardingTour.askBody'),
    },
  ];
}

/**
 * A few pointers shown once setup has finished, before the user lands in the
 * app. Deliberately short: three slides, skippable at any point, and every
 * exit goes through `onFinish` so onboarding is completed the same way
 * whichever button ends it.
 */
export function OnboardingTour({ onFinish }: { onFinish: (route?: string) => void }) {
  const slides = React.useMemo(() => tourSlides(), []);
  const [index, setIndex] = React.useState(0);
  const slide = slides[index];
  const Icon = slide.icon;
  const last = index === slides.length - 1;

  return (
    <div className="min-h-screen bg-background text-foreground" data-onboarding-tour>
      <div className="mx-auto flex max-w-[480px] flex-col items-center px-8 py-16 text-center">
        <Muted className="mb-10 text-[12px]">
          {t('onboardingTour.progress', { current: index + 1, total: slides.length })}
        </Muted>

        <div
          className="mb-6 flex size-14 items-center justify-center rounded-full border border-border bg-muted/40"
          aria-hidden
        >
          <Icon className="size-6" />
        </div>
        <Display className="mb-3" data-onboarding-slide={slide.id}>
          {slide.title}
        </Display>
        <Lead className="mb-6">{slide.body}</Lead>

        {slide.action && (
          <Button variant="outline" onClick={() => onFinish(slide.action?.route)}>
            {slide.action.label}
          </Button>
        )}

        <div className="mt-10 flex gap-1.5" aria-hidden>
          {slides.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === index ? 'w-5 bg-foreground' : 'w-1.5 bg-border',
              )}
            />
          ))}
        </div>

        <div className="mt-8 flex w-full items-center justify-between">
          {index === 0 ? (
            <Button variant="ghost" onClick={() => onFinish()}>
              {t('onboardingTour.skip')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setIndex(index - 1)}>
              {t('onboardingTour.back')}
            </Button>
          )}
          <Button
            size="lg"
            onClick={() => (last ? onFinish() : setIndex(index + 1))}
            autoFocus
          >
            {last ? t('onboardingTour.finish') : t('onboardingTour.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
