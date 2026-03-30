#ifndef __CROW_H
#define __CROW_H

// Step and scope tracking
void __crow_step(int line);
void __crow_push_scope(const char *name, int line);
void __crow_pop_scope(void);

// Variable tracking
void __crow_decl(const char *name, void *addr, int size, const char *type, int line, int flags);
void __crow_set(const char *name, void *addr, int line);

// Heap tracking (replace malloc/calloc/realloc/free)
void *__crow_malloc(int size, int line);
void *__crow_calloc(int count, int size, int line);
void *__crow_realloc(void *ptr, int size, int line);
void __crow_free(void *ptr, int line);

// String functions
char *__crow_strcpy(char *dest, const char *src, int line);

// I/O (replace scanf)
int __crow_scanf_int(int *ptr, int line);
int __crow_scanf_float(float *ptr, int line);
int __crow_scanf_double(double *ptr, int line);
int __crow_scanf_char(char *ptr, int line);
int __crow_scanf_string(char *buf, int bufsize, int line);

#endif
