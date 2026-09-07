import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUhtIssues } from '../uhtChecker';

test('a plain C++ header with no reflection macros is skipped entirely', () => {
  const text = `#pragma once
class FMyHelper
{
public:
  void DoThing();
};
`;
  assert.deepEqual(findUhtIssues('MyHelper', text), []);
});

test('a correctly-formed UCLASS header has no findings', () => {
  const text = `#pragma once
#include "CoreMinimal.h"
#include "MyActor.generated.h"

UCLASS()
class MYGAME_API AMyActor : public AActor
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere)
	UObject* TargetObject;
};
`;
  assert.deepEqual(findUhtIssues('MyActor', text), []);
});

test('flags a missing .generated.h include for a UCLASS file', () => {
  const text = `#pragma once
#include "CoreMinimal.h"

UCLASS()
class AMyActor : public AActor
{
	GENERATED_BODY()
};
`;
  const findings = findUhtIssues('MyActor', text);
  assert.equal(findings.some((f) => f.kind === 'missing-generated-include' && f.detail === 'MyActor.generated.h'), true);
});

test('does not flag the include when present, even with other includes around it', () => {
  const text = `#pragma once
#include "CoreMinimal.h"
#include "MyActor.generated.h"
UCLASS()
class AMyActor : public AActor
{
	GENERATED_BODY()
};
`;
  const findings = findUhtIssues('MyActor', text);
  assert.equal(findings.some((f) => f.kind === 'missing-generated-include'), false);
});

test('flags a UCLASS body with no GENERATED_BODY()', () => {
  const text = `#pragma once
#include "MyActor.generated.h"

UCLASS()
class AMyActor : public AActor
{
public:
	int32 Health;
};
`;
  const findings = findUhtIssues('MyActor', text);
  assert.equal(findings.some((f) => f.kind === 'missing-generated-body' && f.detail === 'AMyActor'), true);
});

test('accepts the older GENERATED_UCLASS_BODY() form', () => {
  const text = `#pragma once
#include "MyActor.generated.h"

UCLASS()
class AMyActor : public AActor
{
	GENERATED_UCLASS_BODY()
};
`;
  assert.deepEqual(
    findUhtIssues('MyActor', text).filter((f) => f.kind === 'missing-generated-body'),
    []
  );
});

test('flags a raw UObject-derived pointer member with no preceding UPROPERTY', () => {
  const text = `#pragma once
#include "MyActor.generated.h"

UCLASS()
class AMyActor : public AActor
{
	GENERATED_BODY()

public:
	UObject* CachedTarget;
};
`;
  const findings = findUhtIssues('MyActor', text);
  assert.equal(findings.some((f) => f.kind === 'unprotected-uobject-pointer' && f.detail === 'UObject* CachedTarget'), true);
});

test('does not flag a pointer member that has a preceding UPROPERTY', () => {
  const text = `#pragma once
#include "MyActor.generated.h"

UCLASS()
class AMyActor : public AActor
{
	GENERATED_BODY()

public:
	UPROPERTY()
	UObject* CachedTarget;
};
`;
  const findings = findUhtIssues('MyActor', text);
  assert.equal(findings.some((f) => f.kind === 'unprotected-uobject-pointer'), false);
});

test('does not treat a function parameter or return type as a member pointer', () => {
  const text = `#pragma once
#include "MyActor.generated.h"

UCLASS()
class AMyActor : public AActor
{
	GENERATED_BODY()

public:
	UFUNCTION()
	void SetTarget(UObject* NewTarget);

	UObject* GetTarget() const;
};
`;
  const findings = findUhtIssues('MyActor', text);
  assert.equal(findings.some((f) => f.kind === 'unprotected-uobject-pointer'), false);
});

test('does not flag members of a plain, non-reflected class in the same file as an unrelated UCLASS', () => {
  const text = `#pragma once
#include "MyActor.generated.h"

class FPlainHelper
{
public:
	UObject* NotReflectedAtAll; // this class was never passed through UCLASS/USTRUCT
};

UCLASS()
class AMyActor : public AActor
{
	GENERATED_BODY()
};
`;
  const findings = findUhtIssues('MyActor', text);
  assert.equal(findings.some((f) => f.detail.includes('NotReflectedAtAll')), false);
});

test('ignores pointer-looking text inside comments', () => {
  const text = `#pragma once
#include "MyActor.generated.h"

UCLASS()
class AMyActor : public AActor
{
	GENERATED_BODY()

public:
	// UObject* CommentedOutPointer;
	int32 Health;
};
`;
  const findings = findUhtIssues('MyActor', text);
  assert.equal(findings.some((f) => f.kind === 'unprotected-uobject-pointer'), false);
});

test('checks USTRUCT bodies the same way as UCLASS bodies', () => {
  const text = `#pragma once
#include "MyData.generated.h"

USTRUCT()
struct FMyData
{
};
`;
  const findings = findUhtIssues('MyData', text);
  assert.equal(findings.some((f) => f.kind === 'missing-generated-body' && f.detail === 'FMyData'), true);
});

test('reports a real line number for a finding inside the class body', () => {
  const text = `#pragma once
#include "MyActor.generated.h"

UCLASS()
class AMyActor : public AActor
{
	GENERATED_BODY()

public:
	UObject* CachedTarget;
};
`;
  const findings = findUhtIssues('MyActor', text);
  const pointerFinding = findings.find((f) => f.kind === 'unprotected-uobject-pointer');
  assert.equal(pointerFinding?.line, 10); // 1-based: "\tUObject* CachedTarget;" is line 10
});
