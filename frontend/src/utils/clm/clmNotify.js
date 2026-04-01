/**
 * Toast notifications wrapper around react-hot-toast.
 */
import toast from 'react-hot-toast';

export const notify = {
  success: (msg) => toast.success(msg, { duration: 3000 }),
  error:   (msg) => toast.error(msg, { duration: 5000 }),
  info:    (msg) => toast(msg, { icon: 'ℹ️', duration: 3000 }),
  warning: (msg) => toast(msg, { icon: '⚠️', duration: 4000 }),
  loading: (msg) => toast.loading(msg),
  dismiss: (id)  => toast.dismiss(id),
  promise: (promise, msgs) => toast.promise(promise, msgs),
};

export default notify;
