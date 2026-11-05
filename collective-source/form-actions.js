import {useState} from 'react';

export function formValues(form) {return Object.fromEntries(new FormData(form));}

export function showValidation(form, error, setMessage) {
  if (!error) return false;
  setMessage(error.message);
  const control = form.elements.namedItem(error.field);
  if (control instanceof HTMLElement) control.focus();
  else control?.[0]?.focus();
  return true;
}

export function useSubmission() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(handler, values, unavailableMessage) {
    if (busy) return;
    setMessage('');
    if (!handler) {setMessage(unavailableMessage); return;}
    setBusy(true);
    try {const result = await handler(values); if (result?.message) setMessage(result.message);}
    catch (error) {setMessage(error instanceof Error ? error.message : 'Please try again.');}
    finally {setBusy(false);}
  }
  return {message, setMessage, busy, submit};
}
