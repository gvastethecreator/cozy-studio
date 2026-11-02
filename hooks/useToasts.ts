export interface ToastMessage {
  id: string;
  message: string;
  type: 'error' | 'success' | 'info' | 'warning';
  duration?: number;
}
