"use client";

import { useRef, useState, type ComponentType, type HTMLAttributes, type ReactNode } from "react";
import { AlertCircle, Trash01, UploadCloud01 } from "@untitledui/icons";
import { HintText } from "@/components/base/input/hint-text";
import { cx } from "@/utils/cx";

export interface FileDropProps {
    label?: string;
    hint?: ReactNode;
    /** Comma separated mime types or extensions, passed to the file picker. */
    accept?: string;
    icon?: ComponentType<HTMLAttributes<HTMLOrSVGElement>>;
    /** Call to action shown when nothing is attached. */
    title?: string;
    /** Small line under the call to action, usually the accepted formats. */
    subtitle?: string;
    /** Name of the attached file. Presence switches the zone to its filled state. */
    fileName?: string | null;
    /** Line shown under the filename, for example "Chinese, 12,480 characters". */
    fileMeta?: ReactNode;
    /** Image preview source. Only used when the attachment is an image. */
    previewUrl?: string | null;
    /** Shows a working state and blocks further input. */
    isBusy?: boolean;
    busyLabel?: string;
    error?: string | null;
    isDisabled?: boolean;
    onFile: (file: File) => void;
    onClear?: () => void;
}

export const FileDrop = ({
    label,
    hint,
    accept,
    icon: Icon = UploadCloud01,
    title = "Drop a file or browse",
    subtitle,
    fileName,
    fileMeta,
    previewUrl,
    isBusy,
    busyLabel = "Reading…",
    error,
    isDisabled,
    onFile,
    onClear,
}: FileDropProps) => {
    const [isOver, setIsOver] = useState(false);
    const depth = useRef(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const blocked = Boolean(isDisabled || isBusy);

    const take = (list: FileList | null) => {
        const file = list?.[0];
        if (file && !blocked) onFile(file);
    };

    const openPicker = () => {
        if (blocked) return;
        inputRef.current?.click();
    };

    return (
        <div className="flex w-full flex-col gap-1.5">
            {label && <span className="text-sm font-medium text-secondary">{label}</span>}

            <div
                onDragEnter={(event) => {
                    event.preventDefault();
                    depth.current += 1;
                    if (!blocked) setIsOver(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                    event.preventDefault();
                    depth.current -= 1;
                    if (depth.current <= 0) setIsOver(false);
                }}
                onDrop={(event) => {
                    event.preventDefault();
                    depth.current = 0;
                    setIsOver(false);
                    take(event.dataTransfer.files);
                }}
                className={cx(
                    "relative flex items-center gap-3.5 rounded-xl bg-primary p-3.5 ring-1 transition duration-100 ease-linear ring-inset",
                    isOver ? "ring-2 ring-brand" : error ? "ring-error_subtle" : "ring-primary",
                    blocked && "opacity-60",
                )}
            >
                {previewUrl ? (
                    <img src={previewUrl} alt="" className="size-14 shrink-0 rounded-lg object-cover ring-1 ring-secondary ring-inset" />
                ) : (
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-fg-quaternary">
                        <Icon className="size-5" />
                    </span>
                )}

                <div className="min-w-0 grow">
                    {fileName ? (
                        <>
                            <p className="truncate text-sm font-semibold text-primary">{fileName}</p>
                            {fileMeta && <p className="mt-0.5 truncate text-sm text-tertiary">{fileMeta}</p>}
                        </>
                    ) : (
                        <>
                            <p className="text-sm font-semibold text-primary">{isBusy ? busyLabel : title}</p>
                            {subtitle && <p className="mt-0.5 text-sm text-tertiary">{subtitle}</p>}
                        </>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    <input
                        ref={inputRef}
                        type="file"
                        accept={accept}
                        className="sr-only"
                        tabIndex={-1}
                        disabled={blocked}
                        onChange={(event) => {
                            take(event.target.files);
                            event.target.value = "";
                        }}
                    />
                    <button
                        type="button"
                        disabled={blocked}
                        onClick={openPicker}
                        className={cx(
                            "cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-brand-secondary transition duration-100 ease-linear outline-focus-ring",
                            "hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-2",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                    >
                        {fileName ? "Replace" : "Browse"}
                    </button>

                    {fileName && onClear && (
                        <button
                            type="button"
                            aria-label="Remove file"
                            onClick={onClear}
                            disabled={blocked}
                            className={cx(
                                "cursor-pointer rounded-lg p-2 text-fg-quaternary transition duration-100 ease-linear outline-focus-ring",
                                "hover:bg-primary_hover hover:text-fg-tertiary focus-visible:outline-2 focus-visible:outline-offset-2",
                                "disabled:cursor-not-allowed disabled:opacity-50",
                            )}
                        >
                            <Trash01 className="size-4" />
                        </button>
                    )}
                </div>
            </div>

            {error ? (
                <span className="flex items-center gap-1.5 text-sm text-error-primary">
                    <AlertCircle className="size-4 shrink-0" />
                    {error}
                </span>
            ) : (
                hint && <HintText>{hint}</HintText>
            )}
        </div>
    );
};

FileDrop.displayName = "FileDrop";
