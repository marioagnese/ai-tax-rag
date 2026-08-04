export type AnalyticsEventParams = Record<
  string,
  string | number | boolean | undefined
>;

type AnalyticsWindow = Window & {
  gtag?: (
    command: "event",
    eventName: string,
    params?: AnalyticsEventParams
  ) => void;
};

export function trackEvent(
  eventName: string,
  params: AnalyticsEventParams = {}
) {
  if (typeof window === "undefined") return;

  const gtag = (window as AnalyticsWindow).gtag;

  if (typeof gtag !== "function") return;

  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined)
  ) as AnalyticsEventParams;

  gtag("event", eventName, cleanParams);
}
