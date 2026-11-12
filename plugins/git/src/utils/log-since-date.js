/** Resolve legacy relative presets to the same date used by the filter label. */
export function logSinceDate(value) {
    if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date();
    if (value === "1 day ago") date.setDate(date.getDate() - 1);
    else if (value === "1 week ago") date.setDate(date.getDate() - 7);
    else if (value === "1 month ago") date.setMonth(date.getMonth() - 1);
    else if (value === "1 year ago") date.setFullYear(date.getFullYear() - 1);
    else return value;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
