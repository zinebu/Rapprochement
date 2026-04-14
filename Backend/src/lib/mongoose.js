import mongoose from "mongoose";

export async function connectMongo() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI non défini dans .env");
  }

  await mongoose.connect(uri);
  console.log("MongoDB connecté");
}