import { MethodConfig, Verbs, Method, MethodResult, Query, Body, SecurityContext, Inject } from '@methodus/server';
import { AuthMiddleware } from './auth.middleware';
import { PixaBay } from './pixabay.contract';
import * as aws from 'aws-sdk';
import * as mime from 'mime';
import * as request from 'request';
import * as bl from 'bl';

import * as moment from 'moment';
import * as uuidv1 from 'uuid/v1';
import { LibraryModel } from '../models';
import { OpenClipart } from './openclipart.contract';
import { SIGVTALRM } from 'constants';
import { ClipArtModel } from '../models/clipart.model';
const S3_BUCKET = process.env.S3_BUCKET;
// const S3_BUCKET_MIN = process.env.S3_BUCKET_MIN;
const S3_REGION = 'us-east-2';
const s3 = new aws.S3({ signatureVersion: 'v4', region: 'us-east-2' });

@MethodConfig('StockDataController', [AuthMiddleware])
export class StockDataController {
    constructor(@Inject() private pixaBay: PixaBay) {

    }
    @Method(Verbs.Get, '/stock/')
    public async searchImages(@Query('q') q: string,
        @Query('page') page: number = 1,
        @Query('per_page') per_page: number = 50,
        @Query('order') order?: string,
        @Query('image_type') image_type?: string,
        @Query('orientation') orientation?: string,
        @Query('category') category?: string): Promise<MethodResult<any>> {
        const response = await this.pixaBay.searchImage(process.env.PIXABAY, q);
        response.result.hits = response.result.hits.map((hit) => {
            try {
                const arr = hit.previewURL.split('/');

                return {
                    Name: arr[arr.length - 1],
                    MediaType: 'image',
                    id: hit.id,
                    imageType: hit.type,
                    largeImageURL: hit.largeImageURL,
                    resource: hit.previewURL,
                    tags: hit.tags,
                    webformatURL: hit.webformatURL,
                    webformatHeight: hit.webformatHeight,
                    webformatWidth: hit.webformatWidth,

                };
            } catch (ex) {
                return null;
            }

        });
        return new MethodResult(response.result);
    }

    @Method(Verbs.Get, '/videos/')
    public async searchVideos(@Query('q') q: string,
        @Query('page') page: number = 1,
        @Query('per_page') per_page: number = 50,
        @Query('order') order?: string,
        @Query('video_type') video_type?: string,

        @Query('category') category?: string): Promise<MethodResult<any>> {
        const response = await this.pixaBay.searchVideo(process.env.PIXABAY, q, 1, 50, 'popularity', 'all');
        response.result.hits = response.result.hits.map((hit) => {

            return {
                MediaType: 'video',
                id: hit.id,
                resource: hit.videos.large.url,
                Thumb: `https://i.vimeocdn.com/video/${hit.picture_id}_295x166.jpg`,
                tags: hit.tags,
                webformatURL: hit.userImageURL,
                webformatHeight: hit.videos.large.height,
                webformatWidth: hit.videos.large.width,

            };
        });
        return new MethodResult(response.result);
    }

    @Method(Verbs.Get, '/clipart/')
    public async clipart(@Query('q') q: string,
        @Query('page') page: number = 1,
        @Query('per_page') per_page: number = 50,
        @Query('order') order: string = 'date',
        @Query('image_type') image_type?: string,
        @Query('orientation') orientation?: string,
        @Query('category') category?: string): Promise<MethodResult<any>> {
        const response = await this.pixaBay.searchImage(process.env.PIXABAY, q, page, per_page, '', 'vector');

        response.result = {
            hits: response.result.hits.map((hit) => {
                const arr = hit.previewURL.split('/');
                return {
                    Name: arr[arr.length - 1],
                    MediaType: 'image',
                    id: hit.id,
                    imageType: hit.type,
                    largeImageURL: hit.largeImageURL,
                    resource: hit.largeImageURL,
                    thumb: hit.webformatURL,
                    tags: hit.tags,
                    webformatURL: hit.webformatURL,
                    webformatHeight: hit.webformatHeight,
                    webformatWidth: hit.webformatWidth,

                };
            }),
        };

        return new MethodResult(response.result);
    }
    @Method(Verbs.Get, '/stock/categories')
    public async categories(): Promise<MethodResult<any>> {
        const result = [
            'fashion', 'nature', 'backgrounds', 'science', 'education',
            'people', 'feelings', 'religion', 'health', 'places', 'animals',
            'industry', 'food', 'computer', 'sports', 'transportation', 'travel',
            'buildings', 'business', 'music',
        ];

        return new MethodResult(result);
    }

    @Method(Verbs.Post, '/stock/import/image')
    public async importImage(@Body('image') image: any, @SecurityContext() securityContext: any): Promise<MethodResult<any>> {

        const promiseResult = new Promise((resolve, reject) => {

            const regexp = /filename=\"(.*)\"/gi;
            let fileName = '';
            let mimeType = '';
            request
                .get(image.webformatURL)
                .on('response', (response) => {
                    if (response.headers['content-disposition'] &&
                        response.headers['content-disposition'] !== 'inline') {
                        fileName = regexp.exec(response.headers['content-disposition'])[1];
                    } else {
                        fileName = image.title;
                    }
                    mimeType = response.headers['content-type'];
                })
                .pipe(bl((error, data) => {

                    const dateKey = moment().format('MM_YYYY');
                    const persist_filename = securityContext._id + '/' + dateKey + '/' + `${image.id}`;

                    const s3Params = {
                        ACL: 'public-read',
                        Bucket: S3_BUCKET,
                        ContentType: mimeType,
                        // Expires: 60,
                        Key: persist_filename,
                    };

                    s3.getSignedUrl('getObject', s3Params, (rawErr: any, rawData: any) => {
                        const returnData = {
                            key: persist_filename,
                            signedRequest: rawData,
                            url: `https://s3.${S3_REGION}.amazonaws.com/${S3_BUCKET}/${persist_filename}`,
                        };
                        const s3obj = new aws.S3({ params: s3Params });
                        s3obj.upload({ Body: data } as any).
                            send((err: any, data: any) => {
                                resolve(returnData);
                            });

                        // });
                    });

                }));

        });
        const uploadResult: any = await promiseResult;

        // insert into local library
        const insertResult = await LibraryModel.insert({
            user_id: securityContext._id,
            Name: image.Name,
            width: image.webformatWidth,
            height: image.webformatHeight,
            thumb: uploadResult.url,
            resource: uploadResult.url,
            Date: new Date(),
            MediaType: 'image',
        });
        return new MethodResult(insertResult);
    }

    @Method(Verbs.Post, '/stock/import/clipart')
    public async importClipart(@Body('image') image: any, @SecurityContext() securityContext: any): Promise<MethodResult<any>> {

        const promiseResult = new Promise((resolve, reject) => {

            const regexp = /filename=\"(.*)\"/gi;
            let fileName = '';
            let mimeType = '';
            request
                .get(image.webformatURL)
                .on('response', (response) => {
                    if (response.headers['content-disposition'] &&
                        response.headers['content-disposition'] !== 'inline') {
                        fileName = regexp.exec(response.headers['content-disposition'])[1];
                    } else {
                        fileName = image.title;
                    }
                    mimeType = response.headers['content-type'];
                })
                .pipe(bl((error, data) => {

                    const dateKey = moment().format('MM_YYYY');
                    const persist_filename = securityContext._id + '/' + dateKey + '/' + `${image.id}`;

                    const s3Params = {
                        ACL: 'public-read',
                        Bucket: S3_BUCKET,
                        ContentType: mimeType,
                        // Expires: 60,
                        Key: persist_filename,
                    };

                    s3.getSignedUrl('getObject', s3Params, (rawErr: any, rawData: any) => {
                        const returnData = {
                            key: persist_filename,
                            signedRequest: rawData,
                            url: `https://s3.${S3_REGION}.amazonaws.com/${S3_BUCKET}/${persist_filename}`,
                        };
                        const s3obj = new aws.S3({ params: s3Params });
                        s3obj.upload({ Body: data } as any).
                            send((err: any, data: any) => {
                                resolve(returnData);
                            });

                        // });
                    });

                }));

        });
        const uploadResult: any = await promiseResult;

        // insert into local library
        const insertResult = await ClipArtModel.insert({
            user_id: securityContext._id,
            Name: image.Name,
            width: image.webformatWidth,
            height: image.webformatHeight,
            thumb: uploadResult.url,
            resource: uploadResult.url,
            Date: new Date(),
            MediaType: 'image',
        });
        return new MethodResult(insertResult);
    }

    @Method(Verbs.Post, '/stock/import/video')
    public async importVideo(@Body('video') video: any, @SecurityContext() securityContext: any): Promise<MethodResult<any>> {

        const promiseResult = new Promise((resolve, reject) => {

            const regexp = /filename=\"(.*)\"/gi;
            let fileName = '';
            let mimeType = '';
            request
                .get(video.resource)
                .on('response', (response) => {
                    if (response.headers['content-disposition'] &&
                        response.headers['content-disposition'] !== 'inline') {
                        fileName = regexp.exec(response.headers['content-disposition'])[1];
                    } else {
                        fileName = video.title;
                    }
                    mimeType = response.headers['content-type'];
                })
                .pipe(bl((error, data) => {
                    console.log(error);

                    const dateKey = moment().format('MM_YYYY');
                    const persist_filename = securityContext._id + '/' + dateKey + '/' + `${video.id}`;

                    const s3Params = {
                        ACL: 'public-read',
                        Bucket: S3_BUCKET,
                        ContentType: mimeType,
                        // Expires: 60,
                        Key: persist_filename,
                    };

                    s3.getSignedUrl('getObject', s3Params, (rawErr: any, rawData: any) => {
                        const returnData = {
                            key: persist_filename,
                            signedRequest: rawData,
                            url: `https://s3.${S3_REGION}.amazonaws.com/${S3_BUCKET}/${persist_filename}`,
                        };
                        const s3obj = new aws.S3({ params: s3Params });
                        s3obj.upload({ Body: data } as any).
                            send((err: any, data: any) => {
                                resolve(returnData);
                            });

                        // });
                    });

                }));

        });
        const uploadResult: any = await promiseResult;

        // insert into local library
        const insertResult = await LibraryModel.insert({
            user_id: securityContext._id,
            Name: video.Name,
            width: video.webformatWidth,
            height: video.webformatHeight,
            Thumb: video.Thumb,
            resource: uploadResult.url,
            Date: new Date(),
            MediaType: 'video',
        });
        return new MethodResult(insertResult);
    }

}
