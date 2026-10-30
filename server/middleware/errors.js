export function notFound(_req, res) {
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Endpoint not found" } });
}
export function errorHandler(error, _req, res, _next) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  let status = 500,
    message = "Internal server error";
  if (error.name === "ZodError") {
    status = 400;
    message = error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  } else if (error.code === 11000) {
    status = 409;
    message =
      "A matching record already exists, or this agent already has an active call";
  } else if (["ValidationError", "CastError"].includes(error.name)) {
    status = 400;
    message = "Invalid record fields";
  } else if (error.name === "VersionError") {
    status = 409;
    message = "Record changed; refresh and try again";
  } else if (error.safe) {
    status = error.status;
    message = error.message;
  } else if (error.type === "entity.parse.failed") {
    status = 400;
    message = "Invalid JSON";
  } else if (error.type === "entity.too.large") {
    status = 413;
    message = "Request is too large";
  } else if (error.status === 403) {
    status = 403;
    message = "Origin not allowed";
  }
  res.status(status).json({ error: { code: "REQUEST_FAILED", message } });
}
