import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "@/components/base/buttons/button.tsx";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  return (
    <ModalOverlay
      isOpen={open}
      isDismissable={!pending}
      onOpenChange={onOpenChange}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm entering:animate-in entering:fade-in exiting:animate-out exiting:fade-out"
    >
      <Modal className="w-full max-w-md rounded-2xl border border-secondary bg-primary p-6 shadow-2xl outline-none entering:animate-in entering:zoom-in-95 exiting:animate-out exiting:zoom-out-95">
        <Dialog role="alertdialog" className="outline-none">
          <Heading slot="title" className="text-lg font-semibold text-primary">
            {title}
          </Heading>
          <p className="mt-2 text-sm leading-6 text-tertiary">{description}</p>
          <div className="mt-6 flex justify-end gap-3">
            <Button color="secondary" isDisabled={pending} onClick={() => onOpenChange(false)}>
              Keep it
            </Button>
            <Button color="primary-destructive" isDisabled={pending} onClick={onConfirm}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
