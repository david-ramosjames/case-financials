import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1E4A7A",
          borderRadius: 36,
          color: "#D3368A",
          fontSize: 118,
          fontWeight: 700,
          fontFamily: "Georgia, 'Times New Roman', serif",
          lineHeight: 1,
        }}
      >
        $
      </div>
    ),
    { ...size }
  );
}
