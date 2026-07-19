-- CreateTable
CREATE TABLE "DeviceEntitlement" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "originalTransactionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceEntitlement_deviceId_originalTransactionId_key" ON "DeviceEntitlement"("deviceId", "originalTransactionId");

-- CreateIndex
CREATE INDEX "DeviceEntitlement_deviceId_idx" ON "DeviceEntitlement"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceEntitlement_expiresAt_idx" ON "DeviceEntitlement"("expiresAt");
