/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test", "<rootDir>/packages"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "Node",
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    "^@cuda-edi/edi-core$": "<rootDir>/packages/edi-core/src/index.ts",
    "^@cuda-edi/enqueue-sdk$": "<rootDir>/packages/enqueue-sdk/src/index.ts",
  },
};
