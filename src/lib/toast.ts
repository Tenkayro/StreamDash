import { toast as sonnerToast, type ExternalToast } from "sonner";

export { sonnerToast as toast };

export interface NotifyOptions extends ExternalToast {
  description?: string;
}

/**
 * Central StreamDash notification helpers backed by `<ToastHost />`.
 */
export const notify = {
  success(message: string, options?: NotifyOptions) {
    return sonnerToast.success(message, options);
  },
  error(message: string, options?: NotifyOptions) {
    return sonnerToast.error(message, { duration: 5500, ...options });
  },
  warning(message: string, options?: NotifyOptions) {
    return sonnerToast.warning(message, { duration: 5000, ...options });
  },
  info(message: string, options?: NotifyOptions) {
    return sonnerToast.info(message, options);
  },
  loading(message: string, options?: NotifyOptions) {
    return sonnerToast.loading(message, options);
  },
  dismiss(id?: string | number) {
    return sonnerToast.dismiss(id);
  },
};
