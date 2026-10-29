// Compare native-decoded WebP pixels against a lossless resized reference.
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <webp/decode.h>
static uint8_t *read_pixels(const char *path, int *w, int *h) {
 FILE *f=fopen(path,"rb"); if(!f)return NULL;
 fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);
 if(size<=0){fclose(f);return NULL;}
 uint8_t *data=malloc((size_t)size);if(!data){fclose(f);return NULL;}
 if(fread(data,1,(size_t)size,f)!=(size_t)size){free(data);fclose(f);return NULL;}
 fclose(f);uint8_t *pixels=WebPDecodeRGBA(data,(size_t)size,w,h);free(data);return pixels;
}
int main(int argc,char **argv) {
 if(argc!=3)return 2;
 int w,h,w2,h2;uint8_t *a=read_pixels(argv[1],&w,&h),*b=read_pixels(argv[2],&w2,&h2);
 if(!a||!b||w!=w2||h!=h2){WebPFree(a);WebPFree(b);return 1;}
 double sum=0,alpha=0;int maxerr=0;
 for(size_t p=0;p<(size_t)w*h;p++) {
  for(int c=0;c<3;c++){int d=(int)a[4*p+c]-(int)b[4*p+c];sum+=(double)d*d;if(abs(d)>maxerr)maxerr=abs(d);}
  int d=(int)a[4*p+3]-(int)b[4*p+3];alpha+=(double)d*d;
 }
 double mse=sum/((double)w*h*3);
 printf("{\"width\":%d,\"height\":%d,\"rgbMse\":%.8f,\"rgbPsnrDb\":",w,h,mse);
 if(mse==0)printf("null");else printf("%.5f",10*log10(255.*255./mse));
 printf(",\"identicalRgb\":%s,\"maxChannelError\":%d,\"alphaRmse\":%.8f}\n",mse==0?"true":"false",maxerr,sqrt(alpha/((double)w*h)));
 WebPFree(a);WebPFree(b);return 0;
}
