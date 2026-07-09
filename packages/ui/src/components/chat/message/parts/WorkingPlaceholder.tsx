import React from 'react';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { BusyDots } from './BusyDots';

interface WorkingPlaceholderProps {
  isWorking: boolean;
  statusText: string | null;
  isGenericStatus?: boolean;
  isWaitingForPermission?: boolean;
  retryInfo?: { attempt?: number; next?: number } | null;
  agentName?: string;
  activeToolName?: string;
}

const STATUS_DISPLAY_TIME_MS = 1200;

const EPOCH_SECONDS_THRESHOLD = 1_000_000_000;
const EPOCH_MILLISECONDS_THRESHOLD = 1_000_000_000_000;

const toRetryTargetTimestamp = (next: number): number => {
  if (next >= EPOCH_MILLISECONDS_THRESHOLD) {
    return next;
  }
  if (next >= EPOCH_SECONDS_THRESHOLD) {
    return next * 1000;
  }
  return Date.now() + next;
};

const formatRetryCountdown = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainderSeconds = seconds % 60;
    return remainderSeconds > 0 ? `${minutes}m ${remainderSeconds}s` : `${minutes}m`;
  }

  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const remainderMinutes = Math.floor((seconds % 3600) / 60);
    return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(seconds / 86400);
  const remainderHours = Math.floor((seconds % 86400) / 3600);
  if (remainderHours > 0) {
    return `${days}d ${remainderHours}h`;
  }

  return `${days}d`;

};

const USING_TOOL_KEY = 'chat.workingStatus.usingTool';
const WAITING_FOR_PERMISSION_KEY = 'chat.workingStatus.waitingForPermission';

export function WorkingPlaceholder({
  isWorking,
  statusText,
  isGenericStatus,
  isWaitingForPermission,
  retryInfo,
  activeToolName,
}: WorkingPlaceholderProps) {
  const { t } = useI18n();
  const [displayedKey, setDisplayedKey] = React.useState<string | null>(null);
  const [displayedPermission, setDisplayedPermission] = React.useState<boolean>(false);
  const [displayedToolName, setDisplayedToolName] = React.useState<string | undefined>(undefined);
  const displayedKeyRef = React.useRef(displayedKey);
  const displayedPermissionRef = React.useRef(displayedPermission);
  displayedKeyRef.current = displayedKey;
  displayedPermissionRef.current = displayedPermission;

  const statusShownAtRef = React.useRef<number>(0);
  const queuedStatusRef = React.useRef<{ key: string; permission: boolean; toolName?: string } | null>(null);
  const processQueueTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Countdown state for retry mode
  const [retryCountdown, setRetryCountdown] = React.useState<number | null>(null);

  React.useEffect(() => {
    const rawNext = retryInfo?.next;
    if (!rawNext || rawNext <= 0) {
      setRetryCountdown(null);
      return;
    }

    const retryTargetAt = toRetryTargetTimestamp(rawNext);

    const update = () => {
      const remaining = Math.max(0, retryTargetAt - Date.now());
      setRetryCountdown(Math.ceil(remaining / 1000));
    };

    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [retryInfo?.next, retryInfo?.attempt]);

  const clearTimers = React.useCallback(() => {
    if (processQueueTimerRef.current) {
      clearTimeout(processQueueTimerRef.current);
      processQueueTimerRef.current = null;
    }
  }, []);

  const showStatus = React.useCallback((key: string, permission: boolean, toolName?: string) => {
    clearTimers();
    queuedStatusRef.current = null;
    setDisplayedKey(key);
    setDisplayedPermission(permission);
    setDisplayedToolName(toolName);
    statusShownAtRef.current = Date.now();
  }, [clearTimers]);

  const scheduleQueueProcess = React.useCallback(() => {
    if (processQueueTimerRef.current) return;
    const elapsed = Date.now() - statusShownAtRef.current;
    const remaining = Math.max(0, STATUS_DISPLAY_TIME_MS - elapsed);
    processQueueTimerRef.current = setTimeout(() => {
      processQueueTimerRef.current = null;

      const queued = queuedStatusRef.current;
      if (queued) {
        showStatus(queued.key, queued.permission, queued.toolName);
      }
    }, remaining);
  }, [showStatus]);

  React.useEffect(() => {
    if (!isWorking) {
      clearTimers();
      queuedStatusRef.current = null;
      setDisplayedKey(null);
      setDisplayedPermission(false);
      setDisplayedToolName(undefined);
      return;
    }

    // Retry state has its own display — skip the normal queue
    if (retryInfo) {
      clearTimers();
      queuedStatusRef.current = null;
      return;
    }

    const incomingKey = isWaitingForPermission ? WAITING_FOR_PERMISSION_KEY : statusText;
    const incomingPermission = Boolean(isWaitingForPermission);
    const incomingGeneric = Boolean(isGenericStatus) && !incomingPermission;
    const incomingToolName = activeToolName;

    if (!incomingKey) {
      return;
    }

    if (!displayedKeyRef.current) {
      showStatus(incomingKey, incomingPermission, incomingToolName);
      return;
    }

    if (incomingKey === displayedKeyRef.current && incomingPermission === displayedPermissionRef.current) {
      return;
    }

    // Ignore generic churn.
    if (incomingGeneric) {
      return;
    }

    const elapsed = Date.now() - statusShownAtRef.current;
    if (elapsed >= STATUS_DISPLAY_TIME_MS) {
      showStatus(incomingKey, incomingPermission, incomingToolName);
      return;
    }

    queuedStatusRef.current = { key: incomingKey, permission: incomingPermission, toolName: incomingToolName };
    scheduleQueueProcess();
  }, [
    isWorking,
    statusText,
    isGenericStatus,
    isWaitingForPermission,
    retryInfo,
    activeToolName,
    clearTimers,
    showStatus,
    scheduleQueueProcess,
  ]);

  React.useEffect(() => () => clearTimers(), [clearTimers]);

  if (!isWorking) {
    return null;
  }

  // Retry state: show countdown and attempt info
  if (retryInfo) {
    const hasCountdown = retryCountdown !== null && retryCountdown > 0;
    const hasAttempt = Boolean(retryInfo.attempt && retryInfo.attempt > 1);
    const countdownStr = hasCountdown ? formatRetryCountdown(retryCountdown as number) : '';
    const attemptNum = hasAttempt ? (retryInfo.attempt as number) : 0;

    const retryText = hasCountdown && hasAttempt
      ? t('chat.workingStatus.retryingInAttempt', { countdown: countdownStr, attempt: attemptNum })
      : hasCountdown
        ? t('chat.workingStatus.retryingIn', { countdown: countdownStr })
        : hasAttempt
          ? t('chat.workingStatus.retryingAttempt', { attempt: attemptNum })
          : t('chat.workingStatus.retrying');

    return (
      <div
        className="flex h-full items-center text-muted-foreground pl-0.5"
        role="status"
        aria-live="polite"
        aria-label={`${retryText}...`}
      >
        <span className="typography-ui-header">
          {retryText}
          <BusyDots />
        </span>
      </div>
    );
  }

  if (!displayedKey) {
    return null;
  }

  const translatedText = displayedKey === USING_TOOL_KEY && displayedToolName
    ? t(displayedKey as I18nKey, { tool: displayedToolName })
    : t(displayedKey as I18nKey);
  const label = translatedText.charAt(0).toUpperCase() + translatedText.slice(1);

  return (
    <div
      className={
        'flex h-full items-center text-muted-foreground pl-0.5'
      }
      role="status"
      aria-live={displayedPermission ? 'assertive' : 'polite'}
      aria-label={label}
      data-waiting={displayedPermission ? 'true' : undefined}
    >
      <span className="typography-ui-header">
        {label}
        <BusyDots />
      </span>
    </div>
  );
}
