import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { storage } from "../firebase";

export async function getFileUrl(pathOrUrl: string) {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  try {
    return await getDownloadURL(storageRef(storage, pathOrUrl));
  } catch (error) {
    console.warn(`File not found or permission denied: ${pathOrUrl}`);
    return "";
  }
}
